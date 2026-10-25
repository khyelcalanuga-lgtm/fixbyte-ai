// Run: node lib/keyboard.check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const compiled = ts.transpileModule(fs.readFileSync("lib/keyboard.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, {
  module: loaded, exports: loaded.exports,
  require: (name) => name === "react-native-keyboard-controller"
    ? { KeyboardAvoidingView: "native-keyboard-view", KeyboardProvider: "native-keyboard-provider" }
    : require(name),
});
const style = { flex: 1 };
const view = loaded.exports.KeyboardAvoidingView({ behavior: "padding", style, children: "input" });
assert.equal(view.props.automaticOffset, true, "all native forms must measure their screen offset");
assert.equal(view.props.behavior, "padding");
assert.equal(view.props.style, style);
assert.equal(view.props.children, "input");
assert.equal(loaded.exports.KeyboardProvider, "native-keyboard-provider");
console.log("keyboard.check: automatic screen offset and native provider preserved");
