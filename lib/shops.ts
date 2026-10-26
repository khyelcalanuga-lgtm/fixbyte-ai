// Repair Shops page data from OpenStreetMap: free, no API key.
// Overpass finds shops; Nominatim turns a typed place ("Quezon City") into coordinates.
// Phones run this themselves (see the Shops page); web goes through app/api/shops+api.ts, since the fast
// Overpass server rejects browsers (it 403s any User-Agent but an app's own, and browsers can't set one).
import { hoursState } from "./hours";

export type ShopQuery = { services: string[]; lat?: number; lng?: number; near?: string; openNow: boolean };

// One cheap Overpass query fetches every repair-ish shop; the filter chips then sort them in code.
// (A query per category with name regexes took 20-40s on the public servers.)
const QUERY = (lat: number, lng: number) => {
  const around = `(around:${RADIUS_M},${lat},${lng})`;
  return `[out:json][timeout:25];(
    nwr["shop"~"^(mobile_phone|mobile_phone_repair|computer|computer_repair|electronics|electronics_repair|repair|appliance)$"]${around};
    nwr["craft"="electronics_repair"]${around};
  );out center tags;`;
};

const fixes = (t: Record<string, string>) =>
  t.craft === "electronics_repair" || "repair" in t || /repair|service|fix|tech/i.test(t.name ?? "");

// Which filter chips a shop matches. Plain "computer" and "electronics" shops are mostly internet cafés and
// stores, so those only count when their tags or name say they repair things.
const CATEGORIES: Record<string, (t: Record<string, string>) => boolean> = {
  "Phone repair": (t) =>
    ["mobile_phone", "mobile_phone_repair"].includes(t.shop) || t["service:mobile_phone:repair"] === "yes" || t.craft === "electronics_repair",
  "Computer repair": (t) =>
    t.shop === "computer_repair" || t["service:computer:repair"] === "yes" || (t.shop === "computer" && fixes(t)) || t.craft === "electronics_repair",
  "Electronics repair": (t) =>
    ["electronics_repair", "repair"].includes(t.shop) || t["service:electronics:repair"] === "yes" || (t.shop === "electronics" && fixes(t)) || t.craft === "electronics_repair",
  "Appliance repair": (t) => t.shop === "repair" || (t.shop === "appliance" && fixes(t)) || t.craft === "electronics_repair",
};

const RADIUS_M = 8000;
// Public Overpass servers are often busy (504) or hang, and which ones changes by the hour, so all are asked at once.
// Measured Oct 2026 with the Manila query: openstreetmap.fr (worldwide data) 3-5 s from a phone in Manila but 15-28 s
// via the hosted server; overpass-api.de queues every caller ~35 s, even for a one-node query; the other three were down or hung.
const OVERPASS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UA = { "User-Agent": "FixByteAI/1.0 (repair shop finder)" }; // OSM's usage policy asks apps to identify themselves

type Element = { id: number; type: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function geocode(place: string) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`, { headers: UA });
  const [hit] = r.ok ? await r.json() : [];
  if (!hit) throw new Error(`Couldn't find "${place}". Try a city or district name.`);
  return { lat: Number(hit.lat), lng: Number(hit.lon) };
}

// The filter chips re-ask the same query, so results are kept per spot (rounded to ~100 m). The promise is cached
// so a chip tapped mid-search waits on that search instead of starting another.
// ponytail: kept for the app's (or server's) lifetime with no expiry; add a TTL if shops going stale ever matters.
const cache = new Map<string, Promise<Element[]>>();
function shopsNear(lat: number, lng: number) {
  const query = QUERY(Number(lat.toFixed(3)), Number(lng.toFixed(3)));
  if (!cache.has(query)) cache.set(query, overpass(query).catch((e) => (cache.delete(query), Promise.reject(e))));
  return cache.get(query)!;
}

// The first server to answer wins; the rest are cancelled so they aren't left doing work for nothing.
// Plain AbortController, setTimeout and a hand-rolled "first success" so it runs on Hermes too
// (AbortSignal.any/timeout and URLSearchParams bodies aren't reliable there).
function overpass(query: string): Promise<Element[]> {
  const done = new AbortController();
  const timer = setTimeout(() => done.abort(), 45000); // past this the page says "busy" rather than spin
  const body = `data=${encodeURIComponent(query)}`;
  const ask = async (url: string) => {
    // A busy server (504) says so within seconds and often answers on the next try, so keep asking until
    // one server answers or time runs out (the aborted signal then ends the loop).
    for (;;) {
      const r = await fetch(url, {
        method: "POST",
        headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: done.signal,
      }).catch((e) => {
        if (done.signal.aborted) throw e;
        return null; // a failed connection gets another try too
      });
      if (r?.ok) return (await r.json()).elements as Element[];
      if (r && r.status !== 504) throw new Error(String(r.status)); // e.g. 429: we're rate-limited, don't hammer
      await new Promise((ok) => setTimeout(ok, 2000));
      if (done.signal.aborted) throw new Error("timeout");
    }
  };
  return new Promise<Element[]>((ok, fail) => {
    let left = OVERPASS.length;
    for (const url of OVERPASS) ask(url).then(ok, () => --left || fail(new Error("Shop search is busy right now. Try again in a moment.")));
  }).finally(() => {
    clearTimeout(timer);
    done.abort();
  });
}

export async function findShops({ services, lat, lng, near, openNow }: ShopQuery) {
  const center = near ? await geocode(near) : lat != null && lng != null ? { lat, lng } : null;
  if (!center) throw new Error("Turn on location or type a place to search.");

  const chosen = services.filter((sv) => CATEGORIES[sv]);
  const tests = (chosen.length ? chosen : Object.keys(CATEGORIES)).map((sv) => CATEGORIES[sv]);
  const elements = await shopsNear(center.lat, center.lng);

  const shops = elements
    .filter((e) => tests.some((test) => test(e.tags ?? {})))
    .map((e) => {
      const t = e.tags ?? {};
      const p = e.center ?? { lat: e.lat!, lon: e.lon! };
      const h = hoursState(t.opening_hours);
      return {
        id: `${e.type}/${e.id}`,
        name: t.name,
        lat: p.lat,
        lng: p.lon,
        km: km(center.lat, center.lng, p.lat, p.lon),
        phone: t.phone ?? t["contact:phone"],
        openNow: h?.openNow,
        closes: h?.closes,
        opens: h?.opens,
      };
    })
    .filter((s) => s.name && s.lat != null) // unnamed points aren't useful to send someone to
    .filter((s) => !openNow || s.openNow !== false) // unknown hours stay; most OSM shops don't list them
    .sort((a, b) => a.km - b.km)
    .slice(0, 5);

  return { shops, center };
}
