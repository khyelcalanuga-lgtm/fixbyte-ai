// Run: node lib/usage-ui.check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("app/index.tsx", "utf8");
const parsed = ts.createSourceFile("index.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const usage = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "Usage");
const code = ts.transpileModule(`${usage.getText(parsed)}\nmodule.exports = Usage;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const loaded = { exports: {} };
let showUpgradeInfo = false;
vm.runInNewContext(code, {
  module: loaded, exports: loaded.exports, require,
  View: "view", Text: "text", Pressable: "pressable", Feather: "icon", DAILY_LIMIT: 3,
  tone: (color) => color,
  useState: () => [showUpgradeInfo, (update) => { showUpgradeInfo = update(showUpgradeInfo); }],
  s: new Proxy({}, { get: (_, key) => key }),
});
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree && typeof tree === "object") return text(tree.props?.children);
  return typeof tree === "string" || typeof tree === "number" ? String(tree) : "";
}
for (const used of [0, 1, 2, 3, 4]) {
  const tree = loaded.exports({ used, error: false });
  const left = Math.max(0, 3 - used);
  assert.ok(text(tree).includes(`${left} / 3 left`));
  const segments = nodes(tree).filter((node) => node.props.style?.[0] === "usageSegment");
  assert.equal(segments.length, 3);
  assert.equal(segments.filter((node) => node.props.style[1]).length, left);
  assert.equal(text(tree).includes("renew daily"), left === 0);
  const summary = nodes(tree).find((node) => node.props.accessible);
  assert.ok(summary.props.accessibilityLabel.startsWith(`${left} of 3 free diagnoses left today.`));
  assert.equal(summary.props.accessibilityLiveRegion, "polite");
}
for (const [used, error, expected] of [[null, false, "Syncing…"], [null, true, "Unavailable"], [0, true, "Unavailable"]]) {
  const tree = loaded.exports({ used, error });
  assert.ok(text(tree).includes(expected));
  assert.ok(!text(tree).includes("left"), "Unknown allowance must not display a remaining count");
  assert.equal(nodes(tree).filter((node) => node.props.style?.[1] === "usageSegmentOn").length, 0);
}
assert.ok(!text(loaded.exports({ used: 0, error: false })).includes("Upgrade"), "Follow-up chats must not show Upgrade");
let tree = loaded.exports({ used: 0, error: false, upgrade: true });
const button = nodes(tree).find((node) => node.props.accessibilityLabel === "Upgrade");
assert.equal(button.props.accessibilityRole, "button");
assert.ok(!tree.props.accessible, "The container must not hide its nested button from screen readers");
button.props.onPress();
tree = loaded.exports({ used: 0, error: false, upgrade: true });
assert.ok(text(tree).includes("Paid plans are coming soon."));
assert.equal(nodes(tree).find((node) => node.props.accessibilityLabel === "Upgrade").props["aria-expanded"], true);
nodes(tree).find((node) => node.props.accessibilityLabel === "Upgrade").props.onPress();
assert.ok(!text(loaded.exports({ used: 0, error: false, upgrade: true })).includes("coming soon"));
console.log("usage-ui.check: all passed");
