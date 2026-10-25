// Run through the Firestore emulator with FIRESTORE_EMULATOR_HOST set.
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase/app");
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, getDocs, collection, deleteDoc, onSnapshot, terminate, Timestamp, setLogLevel } = require("firebase/firestore");

const projectId = "demo-profile-sync";
const address = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(address ?? "", /^(127\.0\.0\.1|localhost):\d+$/, "this check must only use a local emulator");
const [host, port] = address.split(":");
const clients = [];
function client(name, uid) {
  const app = initializeApp({ projectId }, name);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, host, Number(port), uid ? { mockUserToken: { sub: uid } } : undefined);
  clients.push({ app, db });
  return db;
}
const denied = (action) => assert.rejects(action, (e) => e.code === "permission-denied");
setLogLevel("silent");

(async () => {
  const phone = client("phone", "alice");
  const tablet = client("tablet", "alice");
  const other = client("other", "bob");
  const guest = client("guest");
  const profile = doc(phone, "profiles", "alice");
  await setDoc(profile, { avatarColor: "#93C5FD" });
  assert.equal((await getDoc(doc(tablet, "profiles", "alice"))).data().avatarColor, "#93C5FD");
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(new Error("Another device did not receive the color update")); }, 5000);
    const stop = onSnapshot(doc(tablet, "profiles", "alice"), (snapshot) => {
      if (snapshot.data()?.avatarColor === "#C4B5FD") {
        clearTimeout(timeout);
        stop();
        resolve();
      }
    }, (error) => { clearTimeout(timeout); reject(error); });
    setDoc(profile, { avatarColor: "#C4B5FD" }).catch(reject);
  });
  await denied(() => getDoc(doc(other, "profiles", "alice")));
  await denied(() => setDoc(doc(other, "profiles", "alice"), { avatarColor: "#7CEB5A" }));
  await denied(() => deleteDoc(doc(other, "profiles", "alice")));
  await denied(() => getDoc(doc(guest, "profiles", "alice")));
  await denied(() => setDoc(doc(guest, "profiles", "alice"), { avatarColor: "#7CEB5A" }));
  await denied(() => setDoc(profile, { avatarColor: "#000000" }));
  await denied(() => setDoc(profile, { avatarColor: 123 }));
  await denied(() => setDoc(profile, {}));
  await denied(() => setDoc(profile, { avatarColor: "#7CEB5A", admin: true }));
  await denied(() => getDocs(collection(phone, "profiles")));
  assert.equal((await getDoc(profile)).data().avatarColor, "#C4B5FD", "rejected writes preserve the saved color");
  await deleteDoc(profile);
  assert.equal((await getDoc(profile)).exists(), false, "the owner can remove their shared profile");

  const usage = doc(phone, "dailyUsage", "alice");
  const day = Timestamp.fromMillis(Math.floor(Date.now() / 86_400_000) * 86_400_000);
  await setDoc(usage, { day, used: 1 });
  await setDoc(usage, { day, used: 2 });
  await denied(() => setDoc(usage, { day, used: 0 }));
  await denied(() => setDoc(usage, { day, used: 4 }));
  await denied(() => getDoc(doc(other, "dailyUsage", "alice")));
  await denied(() => deleteDoc(usage));
  console.log("profile.rules.check: two-device sync, owner access, color validation, and daily-limit rules passed");
})().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await Promise.all(clients.map(async ({ app, db }) => { await terminate(db); await deleteApp(app); }));
});
