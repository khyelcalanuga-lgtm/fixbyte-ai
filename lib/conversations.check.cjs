// Run: node lib/conversations.check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const stored = new Map();
let full = false;
const loaded = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("lib/conversations.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, {
  module: loaded, exports: loaded.exports,
  require: () => ({ load: key => stored.get(key) ?? null, save: (key, value) => { if (!full) stored.set(key, value); } }),
});
const { loadConversations, saveConversations } = loaded.exports;
const diagnosis = {
  summary: "Screen issue", title: "Loose connector", category: "Hardware", difficulty: "Some skill",
  causes: [{ name: "Loose cable", detail: "Check the connector" }],
  steps: [{ title: "Power off", detail: "Disconnect power", tools: [], warning: "Unplug first" }],
  minutes: 10, problem: "Screen issue", why: "Loose cable", risk: "Electrical", confidence: 80,
  now: [{ icon: "power", text: "Power off" }], shopServices: ["Screen repair"],
};
const chat = {
  id: "thread-1", startedAt: "2026-10-26T01:00:00.000Z", updatedAt: "2026-10-26T01:02:00.000Z", gadget: "phone",
  turns: [
    { role: "user", text: "My screen flickers", image: "data:image/png;base64,cGhvdG8=" },
    { role: "assistant", text: "When does it flicker?", questions: [{ question: "Charging?", options: ["Yes", "No"] }], picked: [undefined] },
    { role: "user", answers: "Charging? Yes" },
    { role: "assistant", text: "Check the connector", questions: [], picked: [], diagnosis, check: "check-1", saved: true, seconds: 2 },
  ],
};
assert.equal(loadConversations("alice").length, 0);
saveConversations("alice", [chat]);
let restored = loadConversations("alice");
assert.equal(restored.length, 1);
assert.equal(JSON.stringify(restored[0]), JSON.stringify(chat), "Messages, photos, questions, diagnosis, bookmarks and history link must survive a restart");
assert.equal(restored[0].turns[1].picked[0], null, "Unpicked options survive JSON serialization");
assert.equal(loadConversations("bob").length, 0, "Another account cannot see Alice's chats");
saveConversations("bob", [{ ...chat, id: "bob-thread" }]);
const newer = { ...chat, id: "thread-2", updatedAt: "2026-10-26T02:00:00.000Z" };
saveConversations("alice", [chat, newer]);
assert.equal(loadConversations("alice")[0].id, "thread-2", "Most recent chats appear first");
const valid = stored.get("conversations-alice");
stored.set("conversations-alice", JSON.stringify([
  chat, { ...chat, id: "../bad" }, { ...chat, startedAt: "invalid" }, { ...chat, turns: [{ role: "assistant", text: "broken", questions: null }] },
  { ...chat, turns: [{ ...chat.turns[1], picked: [] }] },
  { ...chat, turns: [{ ...chat.turns[3], diagnosis: { ...diagnosis, steps: [{}] } }] },
]));
assert.equal(loadConversations("alice").length, 1, "Skip malformed records without hiding intact chats");
stored.set("conversations-alice", "broken json");
assert.equal(loadConversations("alice").length, 0, "Corrupt storage must not crash the app");
stored.set("conversations-alice", valid);
full = true;
assert.throws(() => saveConversations("alice", [chat]), /could not be saved/, "Storage failures must reach the UI");
assert.equal(stored.get("conversations-alice"), valid, "A failed write must preserve the prior saved chats");
full = false;
saveConversations("alice", []);
assert.equal(loadConversations("alice").length, 0, "Erase data clears this account's conversations");
assert.equal(loadConversations("bob").length, 1, "Erasing one account must preserve another account's chats");

const app = ts.createSourceFile("index.tsx", fs.readFileSync("app/index.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const appFunction = app.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "App");
const saveEffect = appFunction.body.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(app) === "useEffect"
  && node.expression.arguments[0].getText(app).includes(".conversations.save("));
assert.ok(saveEffect, "Check the actual conversation persistence effect");
const persist = ts.transpileModule(`(${saveEffect.expression.arguments[0].getText(app)})();`, {}).outputText;
let writes = 0, latestError = "";
const scope = {
  Error,
  uid: "bob", conversationState: { uid: "alice", items: [chat, newer] }, busy: false,
  conversationId: chat.id, startedAt: new Date(chat.startedAt), forGadget: { id: "phone" },
  turns: [...chat.turns, { role: "user", text: "Follow-up" }],
  setConversationState: value => { scope.conversationState = value; },
  library: { current: { uid: "alice", conversations: { save: (_before, items) => { writes++; scope.conversationState = { uid: scope.uid, items }; } } } },
  setConversationError: value => { latestError = value; },
};
vm.runInNewContext(persist, scope);
assert.equal(writes, 0, "Account switching must not save the previous user's transcript into the new account");
scope.uid = "alice";
scope.busy = true;
vm.runInNewContext(persist, scope);
assert.equal(writes, 0, "An in-flight request must not replace the last complete saved exchange");
scope.busy = false;
vm.runInNewContext(persist, scope);
assert.equal(writes, 1);
assert.equal(scope.conversationState.items.length, 2, "Resuming updates one thread and preserves the other chats");
assert.equal(scope.conversationState.items[0].id, chat.id);
assert.equal(scope.conversationState.items[0].turns.at(-1).text, "Follow-up");
vm.runInNewContext(persist, scope);
assert.equal(writes, 1, "Reopening an unchanged chat must not upload its photos again");
scope.turns = [...scope.turns, { role: "user", text: "Another follow-up" }];
scope.library.current.conversations.save = () => { throw new Error("Disk full"); };
vm.runInNewContext(persist, scope);
assert.equal(latestError, "Disk full", "The save error must reach the UI without losing the in-memory conversation");
let clearState;
function findClearState(node) {
  if (ts.isCallExpression(node) && node.expression.getText(app) === "setConversationState" && ts.isArrowFunction(node.arguments[0])) clearState = node.arguments[0];
  ts.forEachChild(node, findClearState);
}
findClearState(appFunction);
assert.ok(clearState, "Check the actual account cleanup state update");
const cleanup = { exports: {} };
vm.runInNewContext(ts.transpileModule(`module.exports = ${clearState.getText(app)};`, {}).outputText, { module: cleanup, uid: "alice" });
const signedOutState = { uid: "offline", items: [newer] };
assert.equal(cleanup.exports(signedOutState), signedOutState, "Finishing account deletion must not replace a new session's conversation state");
assert.equal(cleanup.exports({ uid: "alice", items: [chat] }).items.length, 0, "Erasing the current account clears its in-memory chats");
console.log("conversations.check: round trips, account isolation, ordering, validation, storage failure and cleanup passed");
