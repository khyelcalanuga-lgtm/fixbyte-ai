import { collection, doc, getDoc, getDocs, query, runTransaction, where, writeBatch, type DocumentReference } from "firebase/firestore";
import { validConversation, type Conversation, type Turn } from "./conversations";

type Head = { version: string; parts: number };
const PART_SIZE = 200_000; // Even four-byte Unicode stays below Firestore's 1 MiB document limit.
const head = (value: unknown): value is Head => !!value && typeof value === "object"
  && typeof (value as Head).version === "string" && /^[\w-]{1,128}$/.test((value as Head).version)
  && Number.isInteger((value as Head).parts) && (value as Head).parts >= 0 && (value as Head).parts <= 10000;
const withIds = (conversation: Conversation): Conversation => ({ ...conversation, turns: conversation.turns.map((turn, index) => ({ ...turn, id: turn.id ?? `${conversation.id}-${index}` })) });

export function conversationParts(conversation: Conversation): string[] {
  const payload = JSON.stringify(conversation);
  const parts: string[] = [];
  for (let start = 0; start < payload.length;) {
    let end = Math.min(start + PART_SIZE, payload.length);
    const last = payload.charCodeAt(end - 1);
    if (end < payload.length && last >= 0xd800 && last <= 0xdbff) end--; // Keep emoji surrogate pairs together.
    parts.push(payload.slice(start, end));
    start = end;
  }
  return parts;
}

export function mergeConversation(remote: Conversation, before: Conversation | undefined, after: Conversation): Conversation {
  const base = new Map(withIds(before ?? { ...after, turns: [] }).turns.map(turn => [turn.id, turn]));
  const result = withIds(remote);
  for (const turn of withIds(after).turns) {
    const original = base.get(turn.id);
    const index = result.turns.findIndex(item => item.id === turn.id);
    if (index < 0) { result.turns.push(turn); continue; }
    if (!original) continue; // A retried append must preserve edits another device already made to it.
    const changed = Object.fromEntries(Object.entries(turn).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify((original as unknown as Record<string, unknown>)[key])));
    result.turns[index] = { ...result.turns[index], ...changed } as Turn;
  }
  if (after.gadget !== before?.gadget) result.gadget = after.gadget;
  result.updatedAt = after.updatedAt > remote.updatedAt ? after.updatedAt : remote.updatedAt;
  return result;
}

export async function readCloudConversation(ref: DocumentReference, value: unknown): Promise<Conversation | null | undefined> {
  if (value === null) return null;
  if (!head(value)) throw new Error("Invalid conversation record.");
  if (!value.parts) return undefined; // A first upload has a parent record before its photo parts arrive.
  const snapshot = await getDocs(query(collection(ref, "parts"), where("version", "==", value.version)));
  const parts = snapshot.docs.map(part => part.data()).sort((a, b) => a.index - b.index);
  if (parts.length !== value.parts || parts.some((part, index) => part.index !== index || typeof part.data !== "string" || part.data.length > PART_SIZE)) throw new Error("Conversation is still syncing.");
  const conversation: unknown = JSON.parse(parts.map(part => part.data).join(""));
  if (!validConversation(conversation) || conversation.id !== ref.id) throw new Error("Invalid conversation content.");
  return withIds(conversation);
}

export async function deleteConversationParts(ref: DocumentReference, versions?: string[]) {
  const parts = collection(ref, "parts");
  const snapshots = versions ? await Promise.all([...new Set(versions)].map(version => getDocs(query(parts, where("version", "==", version))))) : [await getDocs(parts)];
  const documents = snapshots.flatMap(snapshot => snapshot.docs);
  for (let offset = 0; offset < documents.length; offset += 400) {
    const batch = writeBatch(ref.firestore);
    for (const part of documents.slice(offset, offset + 400)) batch.delete(part.ref);
    await batch.commit();
  }
}

export async function writeCloudConversation(ref: DocumentReference, change: { value: Conversation | null; before?: Conversation; createOnly?: boolean }, version: string): Promise<{ value: Conversation | null; version?: string; obsolete: string[] }> {
  if (change.value === null) {
    const batch = writeBatch(ref.firestore);
    batch.set(ref, { value: null });
    await batch.commit();
    await deleteConversationParts(ref);
    return { value: null, obsolete: [] };
  }
  // Keep an addressable parent even if an upload stops midway, so account deletion removes every photo part.
  await runTransaction(ref.firestore, async transaction => {
    if (!(await transaction.get(ref)).exists()) transaction.set(ref, { value: { version: "pending", parts: 0 } });
  });
  const previous = (await getDoc(ref)).data()?.value;
  if (previous === null) return { value: null, obsolete: [] };
  const remote = await readCloudConversation(ref, previous);
  if (remote && change.createOnly) return { value: remote, version: head(previous) ? previous.version : undefined, obsolete: [] };
  const conversation = remote ? mergeConversation(remote, change.before, change.value) : withIds(change.value);
  const payload = conversationParts(conversation);
  const parts = payload.length;
  if (parts > 10000) throw new Error("Conversation is too large to sync.");
  // Ten parts also keep a batch below the 10 MiB request limit for non-ASCII messages.
  for (let start = 0; start < parts; start += 10) {
    const batch = writeBatch(ref.firestore);
    for (let index = start; index < Math.min(start + 10, parts); index++) {
      batch.set(doc(collection(ref, "parts"), `${version}-${index}`), { version, index, data: payload[index] });
    }
    await batch.commit();
  }
  await runTransaction(ref.firestore, async transaction => {
    const current = (await transaction.get(ref)).data()?.value;
    if (!head(current) || !head(previous) || current.version !== previous.version || current.parts !== previous.parts) throw new Error("Conversation changed on another device. Retrying.");
    transaction.set(ref, { value: { version, parts } });
  });
  return { value: conversation, version, obsolete: head(previous) && previous.parts ? [previous.version] : [] };
}
