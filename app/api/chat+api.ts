// Tried in order: Flash-Lite takes over when Flash is overloaded or times out (5xx), and OpenRouter's free
// models are the last resort when Gemini is down. Free OpenRouter models answer in ~20-35s, hence the longer wait.
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELS: { url: string; env: string; model: string; models?: string[]; wait: number }[] = [
  { url: GEMINI, env: "GEMINI_API_KEY", model: "gemini-flash-latest", wait: 20000 },
  { url: GEMINI, env: "GEMINI_API_KEY", model: "gemini-flash-lite-latest", wait: 20000 },
  {
    url: "https://openrouter.ai/api/v1/chat/completions",
    env: "OPENROUTER_API_KEY",
    model: "google/gemma-4-31b-it:free",
    models: ["google/gemma-4-31b-it:free", "dots-studio/dots-3-note-preview:free"], // OpenRouter tries these in order itself
    wait: 60000,
  },
];

const SYSTEM = `You are FixByte AI, a friendly tech repair assistant. The user shows or describes damaged hardware or a software problem.
On the user's first report (a photo, a description, or both), never diagnose yet, however obvious or urgent the problem looks
(a swollen battery or water damage still gets questions first). Put 1-3 short clarifying questions in "questions",
each with 2-3 answer options of 1-3 words (like "Yes", "No", "Not sure"), the last one being "Not sure". "message" can be empty then.
Once the user has answered, leave "questions" empty and fill "diagnosis":
"summary": the user's problem in 3-6 words (like "Screen flickers after a drop");
"title": the verdict in 3-6 words starting with "Likely" (like "Likely a loose display connector");
"category": whether the fix is "Hardware", "Software" or "Both";
"difficulty": "Beginner-safe" if a beginner can do the fix safely at home, "Some skill" if it needs tools or care, "Pro repair" if it needs a professional;
"causes": the 2-3 possible causes, most likely first, each with a "name" of 2-6 words and a "detail" of one or two sentences saying why;
"steps": the repair guide, 3-6 steps in order, each with a "title" (2-5 word instruction, like "Lift the screen gently"),
a "detail" (2-4 sentences of exact instructions), "tools" (things needed for that step, 1-3 words each, empty if none)
and a "warning" (when to stop in that step for safety, like "Stop if the battery looks swollen", or empty if none);
"minutes": roughly how long the whole repair takes.
The app shows a "needs a professional" page for "Pro repair" verdicts, so in every diagnosis also fill:
"problem": the problem itself in 2-4 words (like "Swollen battery");
"why": one or two sentences on what is wrong and why it isn't a safe home fix (or, if it is, why it's manageable);
"risk": "Low risk", "Medium risk" or "High risk" for the device and the person;
"confidence": how sure you are of this verdict, 0-100;
"now": 2-4 short things to do right away to stay safe and protect data, each with the icon that fits best;
"shopServices": the 2 kinds of repair shop that fit best, most relevant first (they're the shop search filters).
Put a one-sentence summary of the verdict in "message".
For any later follow-up question, answer in "message" (and "steps" if the answer has steps).
Set "kind" to "questions" when asking clarifying questions, "diagnosis" when giving the verdict, "answer" for follow-ups.
"diagnosis" must always be filled; when "kind" isn't "diagnosis", put your best current guess there (the app ignores it).
Flag safety risks (swollen batteries, mains power, data loss) and say plainly when it's time for a professional or a replacement.
If the photo is unclear, say what you'd need to see.
Always fill the short status labels the app shows on its "Diagnosing" screen, 1-3 words each:
"device": the device you identified, make and model if you can tell (like "iPhone 13"), otherwise its type (like "Laptop");
"deviceType": the kind of device, for the app's icon;
"finding": the main damage or symptom (like "Crack found", "Water damage", "No sound");
"software": whether software could be the cause (like "Not the cause", "Possible cause", "Likely cause").
Write plain text only: no markdown, no ** or # symbols. The app shows your reply as-is.`;

const NOW_ICONS = [
  "power", "zap-off", "upload-cloud", "save", "x-octagon", "slash",
  "alert-triangle", "thermometer", "droplet", "wind", "lock", "battery",
];

// Structured output, so the app can render questions as tappable answer chips.
const SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["questions", "diagnosis", "answer"] },
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
    device: { type: "string" },
    finding: { type: "string" },
    software: { type: "string" },
    diagnosis: {
      type: "object",
      properties: {
        summary: { type: "string" },
        title: { type: "string" },
        category: { type: "string", enum: ["Hardware", "Software", "Both"] },
        difficulty: { type: "string", enum: ["Beginner-safe", "Some skill", "Pro repair"] },
        causes: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, detail: { type: "string" } },
            required: ["name", "detail"],
          },
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              detail: { type: "string" },
              tools: { type: "array", items: { type: "string" } },
              warning: { type: "string" },
            },
            required: ["title", "detail", "tools", "warning"],
          },
        },
        minutes: { type: "integer" },
        problem: { type: "string" },
        why: { type: "string" },
        risk: { type: "string", enum: ["Low risk", "Medium risk", "High risk"] },
        confidence: { type: "integer" },
        now: {
          type: "array",
          items: {
            type: "object",
            // Feather icon names the app can draw.
            properties: { icon: { type: "string", enum: NOW_ICONS }, text: { type: "string" } },
            required: ["icon", "text"],
          },
        },
        // Must match the shop categories in shops+api.ts, which map each one to OpenStreetMap tags.
        shopServices: {
          type: "array",
          items: { type: "string", enum: ["Phone repair", "Computer repair", "Electronics repair", "Appliance repair"] },
        },
      },
      required: [
        "summary", "title", "category", "difficulty", "causes", "steps", "minutes",
        "problem", "why", "risk", "confidence", "now", "shopServices",
      ],
    },
    deviceType: { type: "string", enum: ["phone", "tablet", "laptop", "desktop", "tv", "watch", "headphones", "printer", "other"] },
  },
  // Everything required: Flash-Lite skips optional fields, so "kind" says which ones apply to this reply.
  required: ["kind", "questions", "message", "device", "deviceType", "finding", "software", "diagnosis"],
};

type Diagnosis = {
  summary: string;
  title: string;
  category: string;
  difficulty: string;
  causes: { name: string; detail: string }[];
  steps: { title: string; detail: string; tools: string[]; warning: string }[];
  problem: string;
  why: string;
  now: { icon: string; text: string }[];
};

const numbered = (items: string[]) => items.map((it, i) => `${i + 1}. ${it}`);

// Plain-text version of a diagnosis: what the model sees in later turns, and what the Share button sends.
function diagnosisText(d: Diagnosis) {
  if (d.difficulty === "Pro repair") {
    return [`${d.problem}: needs a professional`, d.why, "Do this now:", ...d.now.map((n) => `- ${n.text}`)].join("\n");
  }
  return [
    d.title,
    `${d.category} · ${d.difficulty}`,
    "Possible causes:",
    ...numbered(d.causes.map((c) => `${c.name}: ${c.detail}`)),
    "Repair steps:",
    ...numbered(d.steps.map((st) => `${st.title}: ${st.detail}`)),
  ].join("\n");
}

const COUNTS = ["", "One quick check", "Two quick checks", "Three quick checks"];

// Runs on the hosted server, so the provider API keys never reach the phone.
// Uses OpenAI-compatible endpoints (Gemini's and OpenRouter's), so messages keep the OpenAI shape the app sends.
export async function POST(req: Request) {
  try {
    const messages = await req.json();
    let error = "";
    models: for (const { url, env, model, models, wait } of MODELS) {
      // Several keys can go in each env var, comma-separated: one that's out of quota (429) or rejected hands over to the next.
      const keys = (process.env[env] ?? "").split(",").map((k: string) => k.trim()).filter(Boolean);
      for (const key of keys) {
        const r = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            models,
            reasoning_effort: "low", // default thinking took ~70s per reply; low answers in ~10s
            response_format: { type: "json_schema", json_schema: { name: "reply", schema: SCHEMA } },
            messages: [{ role: "system", content: SYSTEM }, ...messages],
          }),
          signal: AbortSignal.timeout(wait), // an overloaded Flash can stall 30s+ before failing; move on sooner
        }).catch(() => null);
        if (!r) {
          error = "Request timed out";
          continue models; // a stalled model stalls on every key
        }
        const data = await r.json();
        // OpenRouter can answer 200 with only an error when its upstream provider fails.
        if (r.ok && data.choices?.length) {
          const raw: string = data.choices[0].message.content;
          try {
            const out = JSON.parse(raw);
            const { device, deviceType, finding, software } = out;
            const questions = out.questions ?? [];
            // Questions take precedence: a reply that asks something isn't a diagnosis yet.
            const diagnosis: Diagnosis | undefined = out.kind === "diagnosis" && !questions.length ? out.diagnosis : undefined;
            if (diagnosis) {
              return Response.json({ text: diagnosisText(diagnosis), questions, device, deviceType, finding, software, diagnosis });
            }
            // Steps come back as a list because JSON mode ignores "put each step on its own line".
            const steps = numbered(out.steps ?? []);
            // Written here, not by the model: it kept saying "Two" whatever the actual count.
            const n = questions.length;
            const message = n ? `Got it. ${COUNTS[n] ?? `${n} quick checks`} so I can narrow it down:` : out.message;
            return Response.json({ text: [message, ...steps].join("\n\n"), questions, device, deviceType, finding, software });
          } catch {
            return Response.json({ text: raw, questions: [] }); // model ignored the schema; show it as plain text
          }
        }
        // Gemini wraps some errors in an array.
        error = (Array.isArray(data) ? data[0] : data).error?.message ?? r.statusText;
        if (r.status >= 500) continue models; // 503 overload or 504 timeout: the model's the problem, not the key
      }
    }
    throw new Error(error || "No API key set in .env");
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
