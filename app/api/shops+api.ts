// Repair Shops page data: nearby shops from Google Places (New) plus a static map image.
// Runs server-side in the Expo dev server, so GOOGLE_MAPS_API_KEY (from .env) never reaches the phone.

type Body = { query: string; lat?: number; lng?: number; near?: string; openNow: boolean };

type Place = {
  id: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: { openNow?: boolean; nextCloseTime?: string; nextOpenTime?: string };
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
};

const FIELDS = [
  "id",
  "displayName",
  "location",
  "rating",
  "userRatingCount",
  "currentOpeningHours.openNow",
  "currentOpeningHours.nextCloseTime",
  "currentOpeningHours.nextOpenTime",
  "nationalPhoneNumber",
  "googleMapsUri",
].map((f) => `places.${f}`);

function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export async function POST(req: Request) {
  try {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error("Add GOOGLE_MAPS_API_KEY to .env to find repair shops.");
    const { query, lat, lng, near, openNow }: Body = await req.json();
    const here = lat != null && lng != null && !near;

    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS.join(",") },
      body: JSON.stringify({
        textQuery: near ? `${query} near ${near}` : query,
        maxResultCount: 5,
        openNow,
        ...(here && {
          locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 15000 } },
          rankPreference: "DISTANCE",
        }),
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message ?? r.statusText);

    const shops = ((data.places ?? []) as Place[]).map((p) => ({
      id: p.id,
      name: p.displayName?.text ?? "Repair shop",
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      km: here && p.location ? km(lat!, lng!, p.location.latitude, p.location.longitude) : undefined,
      rating: p.rating,
      reviews: p.userRatingCount,
      openNow: p.currentOpeningHours?.openNow,
      closes: p.currentOpeningHours?.nextCloseTime,
      opens: p.currentOpeningHours?.nextOpenTime,
      phone: p.nationalPhoneNumber,
      mapsUrl: p.googleMapsUri,
    }));

    // Static map with numbered pins (and the user as a small black dot), returned inline so the key stays here.
    let map: string | undefined;
    const pinned = shops.filter((s) => s.lat != null);
    if (pinned.length || here) {
      const params = new URLSearchParams({ size: "362x231", scale: "2", key });
      pinned.forEach((s, i) => params.append("markers", `color:0x7CEB5A|label:${i + 1}|${s.lat},${s.lng}`));
      if (here) params.append("markers", `color:0x000000|size:small|${lat},${lng}`);
      const m = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`);
      // A disabled Maps Static API shouldn't hide the shop list, so the page just skips the map.
      if (m.ok) map = `data:image/png;base64,${Buffer.from(await m.arrayBuffer()).toString("base64")}`;
    }

    return Response.json({ shops, map });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
