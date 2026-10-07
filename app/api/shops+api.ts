// Repair Shops page data from OpenStreetMap: free, no API key.
// Overpass finds shops; Nominatim turns a typed place ("Quezon City") into coordinates.
import { hoursState } from "../../lib/hours";

type Body = { services: string[]; lat?: number; lng?: number; near?: string; openNow: boolean };

// One cheap Overpass query fetches every repair-ish shop; the filter chips then sort them in code.
// (A query per category with name regexes took 20-40s on the public servers.)
const QUERY = (lat: number, lng: number) => {
  const around = `(around:${RADIUS_M},${lat},${lng})`;
  return `[out:json][timeout:20];(
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
// Public Overpass servers are busy at times; the second takes over when the first fails.
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const UA = { "User-Agent": "FixItBot/1.0 (repair shop finder)" }; // OSM's usage policy asks apps to identify themselves

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

async function overpass(query: string): Promise<Element[]> {
  let error = "";
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: UA,
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(20000), // a stuck server moves on to the next one
      });
      if (r.ok) return (await r.json()).elements;
      error = `Shop search is busy (${r.status}). Try again in a moment.`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(error);
}

export async function POST(req: Request) {
  try {
    const { services, lat, lng, near, openNow }: Body = await req.json();
    const center = near ? await geocode(near) : lat != null && lng != null ? { lat, lng } : null;
    if (!center) throw new Error("Turn on location or type a place to search.");

    const chosen = services.filter((sv) => CATEGORIES[sv]);
    const tests = (chosen.length ? chosen : Object.keys(CATEGORIES)).map((sv) => CATEGORIES[sv]);
    const elements = await overpass(QUERY(center.lat, center.lng));

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

    return Response.json({ shops, center });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
