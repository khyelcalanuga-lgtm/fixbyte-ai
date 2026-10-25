// Run: node lib/glass-edges.check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const file = ts.createSourceFile("index.tsx", fs.readFileSync("app/index.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "GlassEdges");
assert.ok(component, "check the actual navbar outline component");
const source = ts.transpileModule(`${component.getText(file)}\nmodule.exports = GlassEdges;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const loaded = { exports: {} };
const scope = vm.createContext({
  module: loaded, exports: loaded.exports, require, useId: React.useId,
  Svg: "svg", Defs: "defs", LinearGradient: "linearGradient", Stop: "stop", Rect: "rect",
  StyleSheet: { absoluteFill: { position: "absolute", inset: 0 } }, DARK: false,
});
vm.runInContext(source, scope);
const GlassEdges = scope.module.exports;
const render = (width, height = 64) => renderToStaticMarkup(React.createElement(GlassEdges, { width, height }));
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
assert.equal(render(0, 0), "", "an unmeasured navbar must not draw invalid geometry");

const previews = [];
for (const dark of [false, true]) {
  scope.DARK = dark;
  for (const viewport of [320, 375, 430]) {
    for (const width of [64, viewport - 106]) {
      const markup = render(width);
      const rect = markup.match(/<rect\b[^>]*>/)[0];
      const stroke = Number(attr(rect, "stroke-width"));
      assert.ok(Number(attr(rect, "x")) >= stroke / 2 && Number(attr(rect, "y")) >= stroke / 2, "the stroke must stay inside the top and left clipping edges");
      assert.ok(Number(attr(rect, "x")) + Number(attr(rect, "width")) + stroke / 2 <= width, "the right curve must stay inside the glass");
      assert.ok(Number(attr(rect, "y")) + Number(attr(rect, "height")) + stroke / 2 <= 64, "the bottom curve must stay inside the glass");
      const stops = [...markup.matchAll(/<stop\b[^>]*>/g)].map(([tag]) => ({ offset: Number(attr(tag, "offset")), opacity: Number(attr(tag, "stop-opacity")) }));
      assert.equal(stops[0].opacity, 0, "the left side must fade completely out");
      assert.equal(stops.at(-1).opacity, 0, "the right side must fade completely out");
      assert.ok(stops[1].offset * width >= 32, "the fade must extend through the full curved end");
      assert.ok(stops.every((stop, i) => stop.offset >= 0 && stop.offset <= 1 && (!i || stop.offset >= stops[i - 1].offset)), "circle and capsule gradient stops must stay ordered");
    }
    previews.push(`<section style="width:${viewport}px;background:${dark ? "#111113" : "#F3F3F3"};color:${dark ? "#E6E6E8" : "#111"}"><p>${viewport}px · ${dark ? "Dark" : "Light"}</p><nav><div class="glass home">${render(64)}<span>⌂</span></div><div class="glass pill">${render(viewport - 106)}<span>Gadgets</span><span>History</span><span>Profile</span></div></nav></section>`);
  }
}
const together = renderToStaticMarkup(React.createElement(React.Fragment, null,
  React.createElement(GlassEdges, { width: 64, height: 64 }),
  React.createElement(GlassEdges, { width: 269, height: 64 }),
));
const ids = [...together.matchAll(/<linearGradient\b[^>]*id="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, 2, "Home and the tab pill must not share a gradient ID");
fs.writeFileSync(".expo/navbar-outline-preview.html", `<!doctype html><meta charset="utf-8"><title>Navbar outline checks</title><style>body{margin:0;padding:20px;background:#777;font:14px system-ui;display:grid;grid-template-columns:430px 430px;gap:16px}section{border-radius:16px;padding:16px 0}p{margin:0 16px 24px}nav{display:flex;gap:10px;margin:0 16px}.glass{position:relative;height:64px;border-radius:32px;background:#ffffff18}.home{width:64px;display:grid;place-items:center;flex-shrink:0}.home span{font-size:28px}.pill{flex:1;display:flex;align-items:center;justify-content:space-around}.pill span{font-size:11px}span{position:relative}</style>${previews.join("")}`);
console.log("glass-edges.check: mobile widths, transparent ends, clipping bounds, and independent gradients passed");
