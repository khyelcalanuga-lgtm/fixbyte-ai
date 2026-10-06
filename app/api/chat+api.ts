// Tried in order: Flash-Lite takes over when Flash is overloaded (503) or rate-limited (429).
const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];

const SYSTEM = `You are a friendly tech repair assistant. The user shows or describes damaged hardware or a software problem.
On the user's first report (a photo, a description, or both), don't diagnose yet. Put 1-3 short clarifying questions in "questions",
each with 2-3 answer options of 1-3 words (like "Yes", "No", "Not sure"), the last one being "Not sure". "message" can be empty then.
Once the user has answered, or you already have enough to go on, leave "questions" empty and diagnose:
the most likely cause in "message", and the fix steps in "steps" (one step per item, no numbers), easiest and cheapest first.
Flag safety risks (swollen batteries, mains power, data loss) and say plainly when it's time for a professional or a replacement.
If the photo is unclear, say what you'd need to see.
Write plain text only: no markdown, no ** or # symbols. The app shows your reply as-is.`;

// Structured output, so the app can render questions as tappable answer chips.
const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } },
        required: ["question", "options"],
      },
    },
    message: { type: "string" },
    steps: { type: "array", items: { type: "string" } },
  },
  required: ["questions", "message"],
};

const COUNTS = ["", "One quick check", "Two quick checks", "Three quick checks"];

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
          response_format: { type: "json_schema", json_schema: { name: "reply", schema: SCHEMA } },
          messages: [{ role: "system", content: SYSTEM }, ...messages],
        }),
      });
      const data = await r.json();
      if (r.ok) {
        const raw: string = data.choices[0].message.content;
        try {
          const out = JSON.parse(raw);
          // Steps come back as a list because JSON mode ignores "put each step on its own line".
          const steps = (out.steps ?? []).map((st: string, i: number) => `${i + 1}. ${st}`);
          const questions = out.questions ?? [];
          // Written here, not by the model: it kept saying "Two" whatever the actual count.
          const n = questions.length;
          const message = n ? `Got it. ${COUNTS[n] ?? `${n} quick checks`} so I can narrow it down:` : out.message;
          return Response.json({ text: [message, ...steps].join("\n\n"), questions });
        } catch {
          return Response.json({ text: raw, questions: [] }); // model ignored the schema; show it as plain text
        }
      }
      // Gemini wraps some errors in an array.
      error = (Array.isArray(data) ? data[0] : data).error?.message ?? r.statusText;
      if (r.status !== 503 && r.status !== 429) break;
    }
    throw new Error(error);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
