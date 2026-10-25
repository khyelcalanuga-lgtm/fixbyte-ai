// Run: node lib/ui-motion.check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync("app/index.tsx", "utf8");
const parsed = ts.createSourceFile("index.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["DotGlow", "Pressable", "Pop", "StepIcon", "TabBar", "makeStyles"];
const constants = new Set(["GLOW_R", "GLOW_Y", "GLOW_GAP", "GREEN", "AMBER", "RING_PAD", "ON_ACCENT", "WHITE", "MONO", "SERIF", "TABS", "TILE"]);
const selected = parsed.statements.filter((node) =>
  ts.isFunctionDeclaration(node) ? names.includes(node.name?.text) :
  ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => constants.has(d.name.getText(parsed))),
);
const code = ts.transpileModule(`${selected.map((n) => n.getText(parsed)).join("\n")}\nmodule.exports = { ${names.join(", ")} };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
let refs = [], cursor = 0, effects = [], motions = [], width = 269;
let canAnimate = false, reducedMotionChanged, activityChanged;
const animationStates = [];
class Value {
  constructor(value) { this.value = value; }
  setValue(value) { this.value = value; }
  stopAnimation() {}
  interpolate(options) { return { options }; }
}
const flatten = (styles) => Array.isArray(styles) ? Object.assign({}, ...styles.map(flatten)) : styles || {};
const moduleValue = { exports: {} };
const scope = vm.createContext({
  module: moduleValue, exports: moduleValue.exports, require,
  useRef: (initial) => refs[cursor++] ?? (refs[cursor - 1] = { current: initial }),
  useState: (initial) => typeof initial === "boolean" ? [canAnimate, (value) => animationStates.push(value)] : [width, () => {}],
  useEffect: (effect) => effects.push(effect), useId: () => "ui-check",
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => false,
    addEventListener: (_event, handler) => { reducedMotionChanged = handler; return { remove() {} }; },
  },
  AppState: { currentState: "active", addEventListener: (_event, handler) => { activityChanged = handler; return { remove() {} }; } },
  Animated: {
    Value, View: "animated-view", multiply: (a, b) => ({ a, b }),
    timing: (value, options) => ({ start: () => { motions.push(options); value.setValue(options.toValue); }, stop() {} }),
    loop: (animation) => animation,
    sequence: (animations) => ({ start: () => animations.forEach((a) => a.start()), stop: () => animations.forEach((a) => a.stop()) }),
  },
  Easing: { out: (easing) => easing, inOut: (easing) => easing, quad: "quad", cubic: "cubic", linear: "linear" },
  StyleSheet: { create: (value) => value, flatten },
  Platform: { OS: "android", select: (options) => options.android ?? options.default },
  NATIVE: true, DARK: false, tone: (value) => value, surface: (value) => value, PAGE_BG: () => "#F3F3F3",
  View: "view", Text: "text", Svg: "svg", Defs: "defs", Circle: "circle", Rect: "rect", Path: "path",
  Pattern: "pattern", RadialGradient: "radialGradient", Mask: "mask", Stop: "stop",
  Feather: "icon", MaterialCommunityIcons: "icon", Glass: "glass", AnimatedPressable: "animated-pressable",
});
vm.runInContext(code, scope);
const api = moduleValue.exports;
scope.s = api.makeStyles();
function render(name, props, fresh = true) {
  if (fresh) refs = [];
  cursor = 0; effects = []; motions = [];
  const tree = api[name](props);
  for (const effect of effects) effect();
  return tree;
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const opacity = (value) => value instanceof Value ? value.value : typeof value === "object" ? opacity(value.a) * value.b : value;

assert.equal(scope.s.input.textAlignVertical, "center");
assert.equal(scope.s.input.paddingVertical, 0);
assert.equal(scope.s.input.includeFontPadding, false);
assert.equal(scope.s.tabLabelOn.color, "#7CEB5A", "active labels must match the green icons");
assert.equal(scope.s.pIcon.backgroundColor, undefined, "Profile icons must have no background");
assert.equal(scope.s.circle.backgroundColor, "#fff", "other pages' icon backgrounds must be preserved");
assert.equal(scope.s.send.backgroundColor, "#7CEB5A", "the send control must keep its background");
const glow = nodes(render("DotGlow"));
assert.ok(glow.length < 20, "returning Home must not remount thousands of SVG dots");
assert.equal(glow.filter((n) => n.type === "pattern").length, 1);
assert.equal(glow.filter((n) => n.type === "circle").length, 1);

let clicks = 0, pressed = 0;
const button = render("Pressable", { style: [{ opacity: 0.5 }], onPress: () => clicks++, onPressIn: () => pressed++ });
assert.ok(!flatten(button.props.style).transform, "pressing a button must not resize it");
button.props.onPressIn({});
assert.equal(pressed, 1, "caller press handlers must still run");
assert.equal(opacity(flatten(button.props.style).opacity), 0.36, "touch feedback must preserve disabled/style opacity");
button.props.onPressOut({});
assert.equal(opacity(flatten(button.props.style).opacity), 0.5);
button.props.onPress();
assert.equal(clicks, 1);
assert.ok(motions.every((m) => m.duration <= 180 && m.useNativeDriver));

const popup = render("Pop", { from: "left", children: "content" });
assert.ok(flatten(popup.props.style).transform.every((t) => !("scale" in t)), "entry animations must keep element sizes fixed");
for (const state of ["done", "active", "next"]) {
  const step = render("StepIcon", { state });
  assert.ok(nodes(step).every((n) => !flatten(n.props.style).transform), "step indicators must not shrink or expand");
  if (state === "next") assert.equal(motions.length, 0, "upcoming steps should remain still");
}

let tab;
const first = render("TabBar", { active: "gadgets", onTab: (next) => { tab = next; }, target: { current: null } });
const findIndicator = (tree) => nodes(tree).find((n) => n.type === "animated-view");
const indicatorWidth = flatten(findIndicator(first).props.style).width;
const second = render("TabBar", { active: "profile", onTab: (next) => { tab = next; }, target: { current: null } }, false);
assert.equal(flatten(findIndicator(second).props.style).width, indicatorWidth, "the selected tab must slide without stretching");
assert.ok(motions.every((m) => m.duration <= 200 && m.useNativeDriver));
nodes(second).find((n) => n.props.accessibilityLabel === "Home").props.onPress();
assert.equal(tab, "home", "Home navigation must dispatch immediately");
const home = nodes(second).find((n) => n.type === "glass" && n.props.style === scope.s.tabHome);
assert.ok(nodes(home).some((n) => n.type === "svg"), "the Home icon must avoid font baseline alignment");
assert.ok(!source.includes("Color choices save automatically"));
assert.ok(!source.includes("Animated.spring("), "UI motion must not bounce or overshoot");
(async () => {
  await Promise.resolve();
  assert.equal(animationStates.at(-1), true, "ambient motion starts only after reading the system preference");
  reducedMotionChanged(true);
  assert.equal(animationStates.at(-1), false, "reduced motion must disable the background animation");
  reducedMotionChanged(false);
  activityChanged("background");
  assert.equal(animationStates.at(-1), false, "inactive apps must pause ambient animation");
  activityChanged("active");
  assert.equal(animationStates.at(-1), true);
  canAnimate = true;
  render("DotGlow");
  assert.equal(motions.length, 2, "ambient animation must gently drift out and back");
  assert.ok(motions.every((m) => m.duration >= 12000 && m.useNativeDriver));
  console.log(`ui-motion.check: ${glow.length}-node ambient background, reduced motion, profile-only icon styling, and navigation passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
