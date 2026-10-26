// Run: node lib/i18n.check.cjs
// Translation lookups behave, and every piece of English the app shows has a row in lib/translations.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const load = (file, scope) => {
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(out, { module: mod, exports: mod.exports, ...scope });
  return mod.exports;
};
const { STRINGS } = load("lib/translations.ts", { require: () => ({ DAILY_LIMIT: 3 }) });
const i18n = load("lib/i18n.tsx", {
  require: (name) =>
    name === "react" ? { createElement: (type, props, ...children) => ({ type, props, children }) }
    : name === "react-native" ? { Text: "text", TextInput: "input" }
    : name === "./translations" ? { STRINGS }
    : require(name),
});

// Lookups
assert.equal(i18n.tr("Sign in"), "Sign in", "English is the key itself");
i18n.setLanguage("Japanese");
assert.equal(i18n.tr("Sign in"), "サインイン");
assert.equal(i18n.tr("{0} checks · {1}", 4, "Oct 5"), "チェック4件 · Oct 5");
assert.equal(i18n.tr("Not in the dictionary"), "Not in the dictionary", "missing strings fall back to English");
assert.deepEqual(i18n.Text({ children: "Save" }).children, ["保存"]);
assert.equal(i18n.tr("Checking your {0}", "iPad"), "iPadをチェック中", "a language can move the value");
const nested = { type: "text" };
assert.deepEqual(i18n.Text({ children: ["Today", " ", nested, 3] }).children, ["今日", " ", nested, 3], "text pieces translate, the rest passes through");
i18n.setLanguage("Klingon");
assert.equal(i18n.tr("Sign in"), "Sign in", "an unknown language shows English");
for (const [key, row] of Object.entries(STRINGS)) {
  assert.equal(row.length, 4, `${key}: one translation per language`);
  const holes = (t) => (t.match(/\{\d\}/g) ?? []).sort().join();
  for (const t of row) assert.equal(holes(t), holes(key), `${key}: "${t}" keeps the same {n} slots`);
}

// Coverage: text in JSX, string children of <Text>, and the props and fields that hold labels.
// Names, addresses, and errors that are caught before anyone sees them.
const KEEP = new Set([
  "FixByte AI", "Google", "Powered by Esri · © OpenStreetMap", "you@example.com", "contact@khyelcalanuga.dev",
  "Cannot attach a gadget to a missing history check", "Location is off.",
]);
const LABEL_KEYS = new Set(["placeholder", "accessibilityLabel", "label", "short", "title", "sub", "subtitle", "detail", "heading", "body", "text"]);
const FILES = ["app/index.tsx", "lib/auth.ts", "lib/usage.ts", "lib/library.ts", "lib/conversations.ts", "lib/profile.ts"];
const missing = new Set();
const want = (text) => {
  if (/[A-Za-z]{2}/.test(text) && !KEEP.has(text) && !(text in STRINGS)) missing.add(text);
};
for (const file of FILES) {
  const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const stylesStart = src.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "makeStyles")?.pos ?? Infinity;
  const visit = (node) => {
    if (node.pos >= stylesStart) return;
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (text) want(text);
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Climb out of `a ? "x" : "y"`, `a || "x"` and parentheses to where the value lands.
      let at = node;
      while (
        ts.isParenthesizedExpression(at.parent) ||
        (ts.isConditionalExpression(at.parent) && at.parent.condition !== at) ||
        (ts.isBinaryExpression(at.parent) && at.parent.right === at && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken].includes(at.parent.operatorToken.kind))
      ) at = at.parent;
      const p = at.parent;
      const child = ts.isJsxExpression(p) && ts.isJsxElement(p.parent); // {"text"} between tags
      const attr = ts.isJsxExpression(p) ? p.parent : p;
      const keyed = (ts.isJsxAttribute(attr) && LABEL_KEYS.has(attr.name.getText(src))) || (ts.isPropertyAssignment(p) && p.initializer === at && LABEL_KEYS.has(p.name.getText(src)));
      const called = (ts.isCallExpression(p) || ts.isNewExpression(p)) && /^(tr|setError|setNote|setDelError|fail|Error|onError)$/.test(p.expression.getText(src));
      const message = ts.isPropertyAssignment(p) && p.initializer === at && /^MESSAGES$/.test(p.parent.parent?.name?.getText(src) ?? ""); // lib/auth's error texts
      if (child || keyed || called || message) want(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}
assert.deepEqual([...missing], [], "Add these to lib/translations.ts (or to KEEP if they stay English)");
console.log(`i18n.check: lookups and ${Object.keys(STRINGS).length} translations passed`);
