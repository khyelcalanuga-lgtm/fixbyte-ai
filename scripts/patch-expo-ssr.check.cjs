// Run: node scripts/patch-expo-ssr.check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const vm = require("node:vm");
const ts = require("typescript");
const expoRequire = createRequire(require.resolve("expo/package.json"));
const file = path.join(path.dirname(expoRequire.resolve("@expo/cli/package.json")), "build/src/start/server/getStaticRenderFunctions.js");
const parsed = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const method = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "evalMetroAndWrapFunctions");
assert.ok(method, "test the installed Expo renderer wrapper");
let runtime;
let evaluations = 0;
const scope = {
  module: { exports: {} },
  evalMetroNoHandling: () => {
    evaluations++;
    const current = runtime = { ready: true };
    let requests = 0;
    return {
      resolveMetadata: async () => assert.ok(current.ready, "metadata used cleared modules"),
      getStreamingContent: async () => { assert.ok(current.ready, "rendering used cleared modules"); return "rendered"; },
      GET: async () => ++requests,
    };
  },
  _metroErrorInterface: { logMetroError: async () => {}, IS_METRO_BUNDLE_ERROR_SYMBOL: Symbol() },
  _errors: { SilentError: class extends Error { constructor(error) { super(error.message); } } },
};
vm.runInNewContext(`module.exports = ${method.getText(parsed)}`, scope);
(async () => {
  const wrapped = scope.module.exports(process.cwd(), "bundle", "render.js", null, false);
  assert.equal(await wrapped.GET(), 1);
  runtime.ready = false;
  await wrapped.resolveMetadata();
  runtime.ready = false;
  assert.equal(await wrapped.getStreamingContent(), "rendered");
  assert.equal(await wrapped.GET(), 2, "API handlers must keep their original module state");
  assert.equal(evaluations, 3, "only development renderer calls re-evaluate the bundle");
  const production = scope.module.exports(process.cwd(), "bundle", "render.js", null, true);
  const before = evaluations;
  await production.resolveMetadata();
  await production.getStreamingContent();
  assert.equal(evaluations, before, "exports must keep the normal renderer behavior");
  console.log("patch-expo-ssr.check: metadata, streaming render, API state, and export behavior passed");
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
