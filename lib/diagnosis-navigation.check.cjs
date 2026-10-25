// Run: node lib/diagnosis-navigation.check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const parsed = ts.createSourceFile("index.tsx", fs.readFileSync("app/index.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["Result", "Shops", "Bookmark"];
const components = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
const source = ts.transpileModule(`${components.map((node) => node.getText(parsed)).join("\n")}\nmodule.exports = { Result, Shops, Bookmark };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const loaded = { exports: {} };
let shared = false;
vm.runInNewContext(source, {
  module: loaded, exports: loaded.exports, require,
  View: "view", Text: "text", Pressable: "pressable", Feather: "icon", Ionicons: "icon", ScrollView: "scroll", TextInput: "input",
  useState: (initial) => [initial, () => {}], useEffect: () => {}, useRef: () => ({ current: null }),
  tone: (color) => color, GREEN: "green", ON_ACCENT: "black", DEVICE_ICONS: {}, NEEDS: {},
  TAGS: { category: { Hardware: {} }, difficulty: { "Beginner-safe": {}, "Pro repair": {} } },
  Share: { share: () => { shared = true; } }, s: {},
});
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const t = { role: "assistant", text: "Get the battery checked.", device: "Phone", diagnosis: { summary: "Battery issue", category: "Hardware", difficulty: "Pro repair", now: [], causes: [] } };
for (const name of ["Result", "Shops"]) {
  let opened = false;
  const tree = loaded.exports[name]({ t, region: "Manila", onBack: () => {}, onGadgets: () => { opened = true; } });
  const button = nodes(tree).find((node) => node.props.accessibilityLabel === "My gadgets");
  assert.ok(button, `${name} must expose its gadget button`);
  assert.equal(button.type, "pressable", `${name}'s device icon must be interactive`);
  assert.equal(button.props.accessibilityRole, "button");
  button.props.onPress();
  assert.equal(opened, true, `${name} must dispatch gadget navigation`);
}
const regular = loaded.exports.Result({ t: { ...t, diagnosis: { ...t.diagnosis, difficulty: "Beginner-safe" } }, onBack: () => {}, onGadgets: () => {} });
nodes(regular).find((node) => node.props.accessibilityLabel === "Share diagnosis").props.onPress();
assert.equal(shared, true, "The regular diagnosis must retain its Share action");
for (const saved of [false, true]) {
  let pressed = false;
  const button = loaded.exports.Bookmark({ saved, big: true, onPress: () => { pressed = true; } });
  assert.equal(button.props.accessibilityRole, "button");
  assert.equal(button.props["aria-pressed"], saved);
  assert.equal(nodes(button).find(node => node.type === "icon").props.name, saved ? "bookmark" : "bookmark-outline");
  assert.equal(nodes(button).find(node => node.type === "text").props.children, saved ? "Saved" : "Save");
  button.props.onPress();
  assert.equal(pressed, true, "Save must dispatch its handler");
}
console.log("diagnosis-navigation.check: all passed");
