// Tried in order: Flash-Lite takes over when Flash is overloaded (503) or rate-limited (429).
const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];

const SYSTEM = `You are a friendly tech repair assistant. The user shows or describes damaged hardware or a software problem.
Identify the most likely cause, then give numbered fix steps, easiest and cheapest first.
Flag safety risks (swollen batteries, mains power, data loss) and say plainly when it's time for a professional or a replacement.
If the photo is unclear, say what you'd need to see.`;

// Runs server-side in the Expo dev server, so the API key (from .env) never reaches the phone.
// Uses Gemini's OpenAI-compatible endpoint, so messages keep the OpenAI shape the app sends.
export async function POST(req: Request) {
  try {
    const messages = await req.json();
    let error = "";
    for (const model of MODELS) {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GEMINI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          reasoning_effort: "low", // default thinking took ~70s per reply; low answers in ~10s
          messages: [{ role: "system", content: SYSTEM }, ...messages],
        }),
      });
      const data = await r.json();
      if (r.ok) return Response.json({ text: data.choices[0].message.content });
      // Gemini wraps some errors in an array.
      error = (Array.isArray(data) ? data[0] : data).error?.message ?? r.statusText;
      if (r.status !== 503 && r.status !== 429) break;
    }
    throw new Error(error);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
