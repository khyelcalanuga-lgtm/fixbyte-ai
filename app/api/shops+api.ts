// Shop search for the web app (phones search themselves; see lib/shops.ts for why) and for older app builds.
import { findShops } from "../../lib/shops";

export async function POST(req: Request) {
  try {
    return Response.json(await findShops(await req.json()));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
