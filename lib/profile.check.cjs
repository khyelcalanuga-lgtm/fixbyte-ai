// Run: node lib/profile.check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.transpileModule(fs.readFileSync("lib/profile.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const stored = new Map();
let writable = true;
let rejectWrites = false;
const docs = new Map();
const listeners = new Map();
const firestore = {
  getFirestore: () => ({}),
  doc: (_db, collection, uid) => `${collection}/${uid}`,
  onSnapshot: (path, next, error) => {
    const subscribers = listeners.get(path) ?? new Set();
    const listener = { next, error };
    subscribers.add(listener);
    listeners.set(path, subscribers);
    next({ data: () => docs.get(path) });
    return () => subscribers.delete(listener);
  },
  setDoc: async (path, data, options) => {
    if (rejectWrites) throw new Error("permission-denied");
    docs.set(path, options.merge ? { ...docs.get(path), ...data } : data);
    for (const listener of listeners.get(path) ?? []) listener.next({ data: () => docs.get(path) });
  },
};
const modules = {
  "firebase/firestore": firestore,
  "./auth": { firebaseAuth: () => ({ app: {} }) },
  "./store": {
    load: (key) => stored.get(key) ?? null,
    save: (key, value) => { if (writable) stored.set(key, value); },
  },
};
const loaded = { exports: {} };
vm.runInNewContext(source, {
  module: loaded, exports: loaded.exports,
  require: (name) => {
    if (!(name in modules)) throw new Error(`Unexpected import: ${name}`);
    return modules[name];
  },
});
const { AVATAR_COLORS, loadAvatarColor, saveAvatarColor, watchAvatarColor, resetAvatarColorCache } = loaded.exports;
const alice = { uid: "alice" };
const bob = { uid: "bob" };
const green = AVATAR_COLORS[0].value;
const blue = AVATAR_COLORS[1].value;
(async () => {
  assert.equal(loadAvatarColor(alice), green, "new accounts use the default green");
  const phone = [];
  const tablet = [];
  let errors = 0;
  const stopPhone = watchAvatarColor(alice.uid, (color) => phone.push(color), () => errors++);
  const stopTablet = watchAvatarColor(alice.uid, (color) => tablet.push(color), () => errors++);
  for (const color of AVATAR_COLORS) {
    await saveAvatarColor(alice, color.value);
    assert.equal(loadAvatarColor(alice), color.value, "every offered color persists across loads");
    assert.equal(phone.at(-1), color.value);
    assert.equal(tablet.at(-1), color.value, "another device receives the saved color");
  }
  await saveAvatarColor(alice, blue);
  assert.equal(docs.get("profiles/alice").avatarColor, blue, "signed-in saves reach Firestore");
  assert.equal(loadAvatarColor(bob), green, "another account must not inherit the selection");
  await saveAvatarColor(null, AVATAR_COLORS[2].value);
  assert.equal(loadAvatarColor(alice), blue, "offline edits must not affect signed-in accounts");
  await assert.rejects(saveAvatarColor(alice, "not-a-color"), /available avatar colors/);
  assert.equal(loadAvatarColor(alice), blue, "invalid choices must not replace the saved color");

  rejectWrites = true;
  await assert.rejects(saveAvatarColor(alice, green), /could not be saved/);
  assert.equal(docs.get("profiles/alice").avatarColor, blue, "failed cloud writes preserve the shared color");
  assert.equal(loadAvatarColor(alice), blue, "failed cloud writes must not overwrite the cache");
  rejectWrites = false;
  writable = false;
  await saveAvatarColor(alice, green);
  assert.equal(tablet.at(-1), green, "cloud saving still works when device storage is unavailable");
  await assert.rejects(saveAvatarColor(null, green), /could not be saved/, "offline storage failure must not report success");
  writable = true;
  resetAvatarColorCache(alice);
  assert.equal(docs.get("profiles/alice").avatarColor, green, "erasing device data must preserve the cloud preference");
  for (const listener of listeners.get("profiles/alice")) listener.error();
  assert.equal(errors, 2, "subscription errors must reach the UI");
  stopPhone();
  stopTablet();
  const count = tablet.length;
  await saveAvatarColor(alice, blue);
  assert.equal(tablet.length, count, "signing out must stop the old account's listener");
  stored.set("profile-color-alice", "invalid-stored-color");
  assert.equal(loadAvatarColor(alice), green, "corrupt stored values fall back to green");
  console.log("profile.check: all passed");
})().catch((e) => { console.error(e); process.exitCode = 1; });
