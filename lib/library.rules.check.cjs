// Run through the Firestore emulator with FIRESTORE_EMULATOR_HOST set.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { initializeApp, deleteApp } = require('firebase/app');
const firestore = require('firebase/firestore');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, collection, disableNetwork, enableNetwork, terminate, setLogLevel } = firestore;
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^(127\.0\.0\.1|localhost):\d+$/, 'local emulator required');
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const source = ts.transpileModule(fs.readFileSync('lib/library.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const clients = [], sessions = [];
setLogLevel('silent');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (check()) return; await pause(30); }
  throw new Error(`Timed out: ${description}`);
}
function client(name, uid = 'alice', stored = new Map()) {
  const app = initializeApp({ projectId: 'demo-library-sync' }, name);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, host, Number(port), uid ? { mockUserToken: { sub: uid } } : undefined);
  const loaded = { exports: {} };
  const imports = name => name === 'firebase/firestore' ? firestore
    : name === './conversations' ? { validConversation: () => false }
    : name === './conversation-cloud' ? {}
    : { load: key => stored.get(key) ?? null, save: (key, value) => stored.set(key, value) };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', source)(
    imports, loaded, loaded.exports, (fn, ms) => setTimeout(fn, Math.min(ms, 150)), clearTimeout);
  const device = { app, db, api: loaded.exports, stored, gadgets: [], history: [], errors: {} };
  device.open = kind => {
    const session = device.api.openLibraryList(db, uid, kind, list => { device[kind] = list; }, error => { device.errors[kind] = error; });
    sessions.push(session);
    return session;
  };
  clients.push(device);
  return device;
}
const gadget = (id, name = id) => ({ id, name, kind: 'Phone', added: '2026-10-25T00:00:00.000Z' });
const check = (id, status = 'checked') => ({ id, gadget: 'legacy', date: '2026-10-25', title: 'Screen', detail: 'Cracked', status });
const denied = action => assert.rejects(action, error => error.code === 'permission-denied');
(async () => {
  const phone = client('phone', 'alice', new Map([
    ['gadgets-alice', JSON.stringify([gadget('legacy')])], ['history-alice', JSON.stringify([check('diagnosis')])],
  ]));
  const tablet = client('tablet');
  const pg = phone.open('gadgets'), ph = phone.open('history');
  const tg = tablet.open('gadgets'), th = tablet.open('history');
  await until(() => tablet.gadgets.length === 1 && tablet.history.length === 1, 'legacy data migrates to the second device');
  await until(() => phone.stored.get('sync-gadgets-alice') === '{}' && phone.stored.get('sync-history-alice') === '{}', 'migration acknowledged');

  const phoneBefore = phone.gadgets, tabletBefore = tablet.gadgets;
  pg.save(phoneBefore, [...phoneBefore, gadget('from-phone')]);
  tg.save(tabletBefore, [...tabletBefore, gadget('from-tablet')]);
  await until(() => phone.gadgets.length === 3 && tablet.gadgets.length === 3, 'concurrent additions preserve both records');
  // An async caller can hold an older rendered list; it must not delete newly received records.
  pg.save(phoneBefore, [...phoneBefore, gadget('late-reply')]);
  await until(() => tablet.gadgets.length === 4, 'stale caller does not replace a newer list');
  th.save(tablet.history, tablet.history.map(item => ({ ...item, status: 'fixed' })));
  await until(() => phone.history[0]?.status === 'fixed', 'history status syncs in real time');
  const oldCheck = phone.history.map(item => ({ ...item, status: 'checked' }));
  ph.save(oldCheck, oldCheck.map(item => ({ ...item, gadget: 'from-phone' })));
  await until(() => tablet.history[0]?.gadget === 'from-phone', 'changes to a different field sync');
  assert.equal(tablet.history[0].status, 'fixed', 'a stale field edit must preserve the newer status');

  pg.save(phone.gadgets, phone.gadgets.filter(item => item.id !== 'legacy'));
  ph.save(phone.history, []);
  await until(() => tablet.gadgets.length === 3 && tablet.history.length === 0, 'deletions sync');
  const old = client('old-install', 'alice', new Map([
    ['gadgets-alice', JSON.stringify([gadget('legacy'), gadget('from-tablet', 'Stale name')])],
    ['history-alice', JSON.stringify([check('diagnosis')])],
  ]));
  old.open('gadgets'); old.open('history');
  await until(() => old.stored.get('sync-gadgets-alice') === '{}' && old.stored.get('sync-history-alice') === '{}', 'old device migration resolves');
  assert.ok(!old.gadgets.some(item => item.id === 'legacy'), 'deleted gadgets must not resurrect');
  assert.equal(old.history.length, 0, 'deleted history must not resurrect');
  assert.equal(old.gadgets.find(item => item.id === 'from-tablet').name, 'from-tablet', 'cloud edits win over legacy copies');

  await disableNetwork(phone.db);
  pg.save(phone.gadgets, [...phone.gadgets, gadget('offline-add')]);
  assert.ok(phone.gadgets.some(item => item.id === 'offline-add'), 'offline changes remain visible');
  const stopping = pg.stop();
  assert.ok(phone.stored.get('sync-gadgets-alice').includes('offline-add'), 'pending changes survive stopping the app');
  await enableNetwork(phone.db);
  await stopping;
  const restarted = phone.open('gadgets');
  await until(() => tablet.gadgets.some(item => item.id === 'offline-add'), 'persisted offline change retries after restart');
  await until(() => phone.stored.get('sync-gadgets-alice') === '{}', 'retry acknowledged');
  await restarted.stop();
  const stoppedLength = phone.gadgets.length;
  tg.save(tablet.gadgets, [...tablet.gadgets, gadget('after-signout')]);
  await until(() => old.gadgets.some(item => item.id === 'after-signout'), 'other live clients still sync');
  assert.equal(phone.gadgets.length, stoppedLength, 'stopped account listener must not receive updates');
  const stale = tablet.gadgets;
  const removed = stale.find(item => item.id === 'from-tablet');
  tg.save(stale, stale.filter(item => item.id !== removed.id));
  await until(() => !old.gadgets.some(item => item.id === removed.id), 'removal reaches other devices');
  tg.save(stale, stale.map(item => item.id === removed.id ? { ...item, name: 'Offline rename' } : item));
  await until(() => tablet.stored.get('sync-gadgets-alice') === '{}', 'stale rename acknowledged');
  assert.ok(!tablet.gadgets.some(item => item.id === removed.id), 'stale edits cannot resurrect a deletion');

  const bob = client('bob', 'bob'), guest = client('guest', null);
  const path = ['accounts', 'alice', 'gadgets', 'from-tablet'];
  await denied(() => getDoc(doc(bob.db, ...path)));
  await denied(() => setDoc(doc(bob.db, ...path), { value: gadget('from-tablet') }));
  await denied(() => getDocs(collection(bob.db, 'accounts', 'alice', 'history')));
  await denied(() => getDoc(doc(guest.db, ...path)));
  await denied(() => setDoc(doc(tablet.db, ...path), { value: { ...gadget('from-tablet'), admin: true } }));
  await denied(() => setDoc(doc(tablet.db, ...path), { value: gadget('wrong-id') }));
  await denied(() => setDoc(doc(tablet.db, 'accounts', 'alice', 'history', 'bad'), { value: { ...check('bad'), status: 'invalid' } }));

  const offline = phone.api.openLibraryList(null, 'offline', 'gadgets', list => { phone.offline = list; }, () => {});
  offline.save([], [gadget('local-only')]); await offline.stop();
  assert.equal(phone.offline[0].id, 'local-only', 'unconfigured offline mode stays usable');
  const saved = (await getDocs(collection(tablet.db, 'accounts', 'alice', 'gadgets'))).size;
  phone.api.clearLibraryCache('alice');
  assert.equal(phone.stored.get('gadgets-alice'), '[]');
  assert.equal((await getDocs(collection(tablet.db, 'accounts', 'alice', 'gadgets'))).size, saved, 'erasing this device must preserve cloud data');
  await Promise.all(sessions.map(session => session.stop()));
  await tablet.api.deleteLibrary(tablet.db, 'alice');
  assert.equal((await getDocs(collection(tablet.db, 'accounts', 'alice', 'gadgets'))).size, 0);
  assert.equal((await getDocs(collection(tablet.db, 'accounts', 'alice', 'history'))).size, 0);
  console.log('library.rules.check: migration, two-device changes, concurrent/stale callers, deletion, offline restart, account isolation, validation and account cleanup passed');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.all(sessions.map(session => session.stop()));
  await Promise.all(clients.map(async ({ app, db }) => { await terminate(db); await deleteApp(app); }));
});
