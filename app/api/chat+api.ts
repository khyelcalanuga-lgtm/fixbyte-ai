// Tried in order until one answers. All are free tiers with OpenAI-compatible endpoints; a provider whose key
// isn't set (in .env locally, EAS env vars when hosted) is skipped. Gemini comes first but is sometimes refused by
// region on the hosted server; the next ones aren't region-blocked. Free OpenRouter models answer in ~20-35s, so
// they're last with the longest wait. `extra` holds provider-specific fields: some (Mistral) reject unknown ones.
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const LOW = { reasoning_effort: "low" }; // default thinking took ~70s per reply; low answers in ~10s
type Provider = { url: string; env: string; model: string; extra?: Record<string, unknown>; wait: number };
const MODELS: Provider[] = [
  { url: GEMINI, env: "GEMINI_API_KEY", model: "gemini-flash-latest", extra: LOW, wait: 20000 },
  { url: GEMINI, env: "GEMINI_API_KEY", model: "gemini-flash-lite-latest", extra: LOW, wait: 20000 },
  // Groq and Mistral models checked against their keys on 2026-10-09; GitHub Models still unverified (no token yet).
  // A wrong or retired model fails fast (4xx) and the next takes over.
  { url: "https://api.groq.com/openai/v1/chat/completions", env: "GROQ_API_KEY", model: "qwen/qwen3.8-27b", wait: 20000 }, // sees photos; ~1-2s
  { url: "https://api.mistral.ai/v1/chat/completions", env: "MISTRAL_API_KEY", model: "mistral-small-latest", wait: 30000 },
  { url: "https://models.github.ai/inference/chat/completions", env: "GITHUB_MODELS_TOKEN", model: "openai/gpt-4.1-mini", wait: 30000 },
  {
    url: "https://openrouter.ai/api/v1/chat/completions",
    env: "OPENROUTER_API_KEY",
    model: "google/gemma-4-31b-it:free",
    // OpenRouter tries these in order itself.
    extra: { ...LOW, models: ["google/gemma-4-31b-it:free", "dots-studio/dots-3-note-preview:free"] },
    wait: 60000,
  },
];

const SYSTEM = `You are FixByte AI, a friendly tech repair assistant. The user shows or describes damaged hardware or a software problem.
On the user's first report (a photo, a description, or both), never diagnose yet, however obvious or urgent the problem looks
(a swollen battery or water damage still gets questions first). Put 1-3 short clarifying questions in "questions",
each with 2-4 answer options of 1-3 words, the last one being "Not sure". The options are the answers the user taps, so each must
directly answer its own question: "Are the lines vertical or horizontal?" gets "Vertical", "Horizontal", "Not sure";
"How long has it been happening?" gets "Today", "A few days", "Weeks or more", "Not sure"; only a yes/no question
(like "Did it get wet?") gets "Yes", "No", "Not sure". Never give Yes/No options to an either/or or open question. "message" can be empty then.
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
    // The app sends { messages, language }; older builds (the installed APK) send just the messages.
    const body = await req.json();
    const messages = Array.isArray(body) ? body : body.messages;
    const language: string | undefined = Array.isArray(body) ? undefined : body.language;
    // Field names and the fixed choices (kind, category, difficulty, risk...) stay English: the app reads them.
    // From the new-account questions. Clipped, since they're inserted into the system prompt.
    const profile = Array.isArray(body) ? undefined : body.profile;
    const skill = typeof profile?.skill === "string" ? profile.skill.slice(0, 60) : "";
    const devices = Array.isArray(profile?.devices) ? profile.devices.slice(0, 10).map((d: unknown) => String(d).slice(0, 30)) : [];
    // "Check this gadget" in the app: the chat is about this one device.
    const gadget = profile?.gadget && typeof profile.gadget.name === "string" ? profile.gadget : undefined;
    const system = [
      SYSTEM,
      language && language !== "English" &&
        `Write all text meant for the user (messages, questions, answer options, titles, details) in ${language}.`,
      skill && `The user describes their repair experience as "${skill}": match the detail of the steps and the safety warnings to that.`,
      devices.length && `Gadgets the user owns: ${devices.join(", ")}.`,
      gadget &&
        `The user is asking about their ${String(gadget.kind ?? "device").slice(0, 30)} "${gadget.name.slice(0, 40)}": use that as the device.`,
    ]
      .filter(Boolean)
      .join("\n");
    let error = "";
    const tried: string[] = []; // failed attempts, reported in the x-tried header
    models: for (const { url, env, model, extra, wait } of MODELS) {
      // Several keys can go in each env var, comma-separated: one that's out of quota (429) or rejected hands over to the next.
      const keys = (process.env[env] ?? "").split(",").map((k: string) => k.trim()).filter(Boolean);
      if (!keys.length) tried.push(`${model}: no ${env}`);
      for (const key of keys) {
        const r = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            ...extra,
            response_format: { type: "json_schema", json_schema: { name: "reply", schema: SCHEMA } },
            messages: [{ role: "system", content: system }, ...messages],
          }),
          signal: AbortSignal.timeout(wait), // an overloaded Flash can stall 30s+ before failing; move on sooner
        }).catch(() => null);
        if (!r) {
          error = "Request timed out";
          tried.push(`${model}: timeout`);
          continue models; // a stalled model stalls on every key
        }
        const data = await r.json();
        // OpenRouter can answer 200 with only an error when its upstream provider fails.
        if (r.ok && data.choices?.length) {
          const raw: string = data.choices[0].message.content;
          // Which model answered and what failed first: shows where a slow reply's time went.
          const headers = { "x-model": data.model ?? model, "x-tried": tried.join(" | ") };
          try {
            const out = JSON.parse(raw);
            const { device, deviceType, finding, software } = out;
            const questions = out.questions ?? [];
            // Questions take precedence: a reply that asks something isn't a diagnosis yet.
            const diagnosis: Diagnosis | undefined = out.kind === "diagnosis" && !questions.length ? out.diagnosis : undefined;
            if (diagnosis) {
              return Response.json({ text: diagnosisText(diagnosis), questions, device, deviceType, finding, software, diagnosis }, { headers });
            }
            // Steps come back as a list because JSON mode ignores "put each step on its own line".
            const steps = numbered(out.steps ?? []);
            // Written here, not by the model: it kept saying "Two" whatever the actual count.
            const n = questions.length;
            const message = n ? `Got it. ${COUNTS[n] ?? `${n} quick checks`} so I can narrow it down:` : out.message;
            return Response.json({ text: [message, ...steps].join("\n\n"), questions, device, deviceType, finding, software }, { headers });
          } catch {
            return Response.json({ text: raw, questions: [] }, { headers }); // model ignored the schema; show it as plain text
          }
        }
        // Gemini wraps some errors in an array.
        error = (Array.isArray(data) ? data[0] : data).error?.message ?? r.statusText;
        tried.push(`${model}: ${r.status} ${error}`.slice(0, 120));
        if (r.status >= 500) continue models; // 503 overload or 504 timeout: the model's the problem, not the key
      }
    }
    throw new Error(error || "No API key set in .env");
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
