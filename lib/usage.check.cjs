// Run: node lib/usage.check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.transpileModule(fs.readFileSync("lib/usage.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const docs = new Map();
const listeners = new Map();
let now = Date.parse("2026-10-25T12:00:00Z");
const Timestamp = { fromMillis: (ms) => ({ toMillis: () => ms }) };
const firestore = {
  Timestamp,
  getFirestore: () => ({}),
  doc: (_db, _collection, uid) => uid,
  onSnapshot: (uid, next) => {
    const subscribers = listeners.get(uid) ?? new Set();
    subscribers.add(next);
    listeners.set(uid, subscribers);
    next({ data: () => docs.get(uid) });
    return () => subscribers.delete(next);
  },
  runTransaction: async (_db, action) => action({
    get: async (uid) => ({ data: () => docs.get(uid) }),
    set: (uid, data) => {
      docs.set(uid, data);
      for (const listener of listeners.get(uid) ?? []) listener({ data: () => data });
    },
  }),
};
const loaded = { exports: {} };
vm.runInNewContext(source, {
  module: loaded, exports: loaded.exports,
  Date: class extends Date { static now() { return now; } },
  setTimeout: () => 1,
  clearTimeout: () => {},
  require: (name) => ({
    "./store": { load: () => null, save: () => {} },
    "./auth": { firebaseAuth: () => ({ app: {} }) },
    "firebase/firestore": firestore,
  })[name],
});

(async () => {
  const usage = loaded.exports;
  const phone = [];
  const tablet = [];
  const stopPhone = usage.watchSharedUsage("same-account", (n) => phone.push(n), () => {});
  const stopTablet = usage.watchSharedUsage("same-account", (n) => tablet.push(n), () => {});
  assert.equal(phone.at(-1), 0);
  assert.equal(tablet.at(-1), 0);
  for (const expected of [1, 2, 3]) assert.equal(await usage.recordSharedUse("same-account"), expected);
  assert.equal(phone.at(-1), 3);
  assert.equal(tablet.at(-1), 3, "another device receives the shared count");
  await assert.rejects(usage.recordSharedUse("same-account"), /used today's 3 free diagnoses/);
  assert.equal(docs.get("same-account").used, 3, "a fourth request does not change the count");
  assert.equal(await usage.recordSharedUse("other-account"), 1, "another account has its own limit");
  now += 86_400_000;
  assert.equal(await usage.recordSharedUse("same-account"), 1, "the next UTC day starts at one");
  stopPhone();
  stopTablet();
  console.log("usage.check: all passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
