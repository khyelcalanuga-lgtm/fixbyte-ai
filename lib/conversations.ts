import { load, save } from "./store";

export type Question = { question: string; options: string[] };
export type Diagnosis = {
  summary: string;
  title: string;
  category: "Hardware" | "Software" | "Both";
  difficulty: "Beginner-safe" | "Some skill" | "Pro repair";
  causes: { name: string; detail: string }[];
  steps: { title: string; detail: string; tools: string[]; warning: string }[];
  minutes: number;
  problem: string;
  why: string;
  risk: string;
  confidence: number;
  now: { icon: string; text: string }[];
  shopServices: string[];
};
export type Turn =
  | { id?: string; role: "user"; image?: string; text?: string; answers?: string }
  | {
      id?: string;
      role: "assistant";
      text: string;
      questions: Question[];
      picked: (string | null | undefined)[]; // JSON stores unpicked answers as null.
      device?: string;
      deviceType?: string;
      finding?: string;
      diagnosis?: Diagnosis;
      seconds?: number;
      saved?: boolean;
      check?: string;
    };
export type Conversation = { id: string; startedAt: string; updatedAt: string; gadget: string | null; turns: Turn[] };
const key = (uid: string) => `conversations-${uid}`;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const textFields = (value: Record<string, unknown>, fields: string[]) => fields.every(field => typeof value[field] === "string");
function validDiagnosis(value: unknown): value is Diagnosis {
  if (!record(value)) return false;
  return textFields(value, ["summary", "title", "problem", "why", "risk"])
    && ["Hardware", "Software", "Both"].includes(value.category as string)
    && ["Beginner-safe", "Some skill", "Pro repair"].includes(value.difficulty as string)
    && typeof value.minutes === "number" && Number.isFinite(value.minutes)
    && typeof value.confidence === "number" && Number.isFinite(value.confidence)
    && Array.isArray(value.causes) && value.causes.every(item => record(item) && textFields(item, ["name", "detail"]))
    && Array.isArray(value.steps) && value.steps.every(item => record(item) && textFields(item, ["title", "detail", "warning"]) && strings(item.tools))
    && Array.isArray(value.now) && value.now.every(item => record(item) && textFields(item, ["icon", "text"]))
    && strings(value.shopServices);
}
function validTurn(value: unknown): value is Turn {
  if (!record(value)) return false;
  if (value.id !== undefined && (typeof value.id !== "string" || !/^[\w-]{1,160}$/.test(value.id))) return false;
  if (value.role === "user") return ["text", "image", "answers"].every(field => value[field] === undefined || typeof value[field] === "string");
  return value.role === "assistant" && typeof value.text === "string"
    && Array.isArray(value.questions) && value.questions.every(q => record(q) && typeof q.question === "string" && strings(q.options))
    && Array.isArray(value.picked) && value.picked.every(pick => pick == null || typeof pick === "string")
    && value.picked.length === value.questions.length
    && ["device", "deviceType", "finding", "check"].every(field => value[field] === undefined || typeof value[field] === "string")
    && (value.seconds === undefined || (typeof value.seconds === "number" && Number.isFinite(value.seconds)))
    && (value.saved === undefined || typeof value.saved === "boolean")
    && (value.diagnosis === undefined || validDiagnosis(value.diagnosis));
}
export function validConversation(item: unknown): item is Conversation {
  return record(item) && typeof item.id === "string" && /^[\w-]{1,128}$/.test(item.id)
    && typeof item.startedAt === "string" && Number.isFinite(Date.parse(item.startedAt))
    && typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt))
    && (item.gadget === null || typeof item.gadget === "string")
    && Array.isArray(item.turns) && item.turns.length > 0 && item.turns.every(validTurn);
}
export function loadConversations(uid: string): Conversation[] {
  try {
    const data: unknown = JSON.parse(load(key(uid)) ?? "[]");
    if (!Array.isArray(data)) return [];
    return data.filter(validConversation)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch { return []; }
}
export function saveConversations(uid: string, conversations: Conversation[]) {
  const data = JSON.stringify(conversations);
  save(key(uid), data);
  if (load(key(uid)) !== data) throw new Error("Conversation could not be saved. Free up device storage and try again.");
}
