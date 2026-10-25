import { collection, doc, getDocs, onSnapshot, runTransaction, writeBatch, type Firestore } from "firebase/firestore";
import { load, save } from "./store";

export type Gadget = { id: string; name: string; kind: string; added: string };
export type CheckStatus = "fixed" | "checked" | "pro";
export type Check = { id: string; gadget: string; date: string; title: string; detail: string; status: CheckStatus };
type Library = { gadgets: Gadget; history: Check };
type Kind = keyof Library;
type Change<T> = { value: T | null; createOnly?: boolean; patch?: Partial<T> };
export type LibraryList<T> = { save: (before: T[], after: T[]) => void; stop: () => Promise<void> };
export const newLibraryId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

function validItem<K extends Kind>(kind: K, value: unknown): value is Library[K] {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const fields = kind === "gadgets" ? ["id", "name", "kind", "added"] : ["id", "gadget", "date", "title", "detail", "status"];
  return fields.every(key => typeof v[key] === "string") && typeof v.id === "string" && /^[\w-]{1,128}$/.test(v.id)
    && (kind !== "history" || ["fixed", "checked", "pro"].includes(v.status as string));
}

export function clearLibraryCache(uid: string) {
  for (const kind of ["gadgets", "history"]) {
    save(`${kind}-${uid}`, "[]");
    save(`sync-${kind}-${uid}`, "{}");
  }
}

// Each item has its own document: editing one device must not replace another device's whole list.
export function openLibraryList<K extends Kind>(db: Firestore | null, uid: string, kind: K,
  onChange: (items: Library[K][]) => void, onError: (message: string) => void): LibraryList<Library[K]> {
  type Item = Library[K];
  const key = `${kind}-${uid}`;
  const pendingKey = `sync-${key}`;
  let local: Item[] = [];
  let pending: Record<string, Change<Item>> = {};
  try { const data = JSON.parse(load(key) ?? "[]"); if (Array.isArray(data)) local = data.filter(item => validItem(kind, item)); } catch {}
  const storedPending = load(pendingKey);
  try {
    const data = JSON.parse(storedPending ?? "{}");
    for (const [id, change] of Object.entries(data)) {
      const c = change as Change<Item>;
      if (/^[\w-]{1,128}$/.test(id) && c && (c.value === null || (validItem(kind, c.value) && c.value.id === id))) pending[id] = c;
    }
  } catch {}
  // Import old device-only records once. Existing cloud records (including deletions) always win.
  if (db && storedPending === null) for (const item of local) pending[item.id] = { value: item, createOnly: true };
  let remote = new Map<string, Item | null>(local.map(item => [item.id, item]));
  let stopped = false, listening = false;
  let unsubscribe: (() => void) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let flushing: Promise<void> | undefined;
  const persist = () => save(pendingKey, JSON.stringify(pending));
  const publish = () => {
    if (stopped) return;
    const merged = new Map(remote);
    for (const [id, change] of Object.entries(pending)) {
      if (change.createOnly && remote.has(id)) continue;
      const existing = remote.get(id);
      merged.set(id, change.patch && remote.has(id) ? existing === null ? null : { ...existing!, ...change.patch } : change.value);
    }
    local = [...merged.values()].filter((item): item is Item => item !== null);
    local.sort((a, b) => b.id.localeCompare(a.id));
    save(key, JSON.stringify(local));
    onChange(local);
  };
  const fail = () => {
    if (stopped) return;
    onError("Sync is unavailable. Your saved items stay on this device; we'll retry automatically.");
    if (!retry) retry = setTimeout(() => { retry = undefined; if (!listening) listen(); flush(); }, 10000);
  };
  const flush = () => {
    if (!db || stopped || flushing || !Object.keys(pending).length) return;
    flushing = (async () => {
      try {
        for (const [id, change] of Object.entries(pending)) {
          if (stopped) break;
          const ref = doc(db, "accounts", uid, kind, id);
          await runTransaction(db, async transaction => {
            const existing = await transaction.get(ref);
            if (change.createOnly && existing.exists()) return;
            const value = existing.data()?.value;
            if (change.patch && existing.exists() && value === null) return;
            transaction.set(ref, { value: change.patch && existing.exists() ? { ...value, ...change.patch } : change.value });
          });
          if (stopped) return;
          if (pending[id] === change) delete pending[id];
          persist();
          publish();
        }
        if (!stopped && listening) onError("");
      } catch { fail(); }
    })().finally(() => { flushing = undefined; if (!stopped && !retry) flush(); });
  };
  const listen = () => {
    if (!db || stopped) return;
    unsubscribe?.();
    listening = true;
    unsubscribe = onSnapshot(collection(db, "accounts", uid, kind), { includeMetadataChanges: true }, snapshot => {
      if (stopped || snapshot.metadata.fromCache) return;
      const records = new Map<string, Item | null>();
      for (const document of snapshot.docs) {
        const value = document.data().value;
        if (value === null || (validItem(kind, value) && value.id === document.id)) records.set(document.id, value);
      }
      remote = records;
      publish();
      if (!Object.keys(pending).length) onError("");
    }, () => { listening = false; fail(); });
  };
  persist();
  publish();
  listen();
  flush();
  return {
    save(before, after) {
      if (stopped) return;
      const previous = new Map(before.map(item => [item.id, item]));
      const next = new Map(after.map(item => [item.id, item]));
      for (const id of previous.keys()) if (!next.has(id)) pending[id] = { value: null };
      for (const item of after) {
        if (!validItem(kind, item)) throw new Error("This item could not be saved.");
        const beforeItem = previous.get(item.id);
        if (JSON.stringify(beforeItem) === JSON.stringify(item)) continue;
        const queued = pending[item.id];
        const patch = beforeItem ? Object.fromEntries(Object.entries(item).filter(([key, value]) => value !== beforeItem[key as keyof Item])) as Partial<Item> : undefined;
        pending[item.id] = !beforeItem ? { value: item, createOnly: true }
          : { value: item, ...(patch && (!queued || queued.patch || queued.createOnly) ? { patch: { ...queued?.patch, ...patch } } : {}) };
      }
      persist();
      publish();
      if (!db) { remote = new Map(local.map(item => [item.id, item])); pending = {}; persist(); }
      flush();
    },
    async stop() { stopped = true; unsubscribe?.(); if (retry) clearTimeout(retry); await flushing; },
  };
}

export async function deleteLibrary(db: Firestore, uid: string) {
  for (const kind of ["gadgets", "history"]) {
    const snapshot = await getDocs(collection(db, "accounts", uid, kind));
    for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
      const batch = writeBatch(db);
      for (const document of snapshot.docs.slice(offset, offset + 400)) batch.delete(document.ref);
      await batch.commit();
    }
  }
}
