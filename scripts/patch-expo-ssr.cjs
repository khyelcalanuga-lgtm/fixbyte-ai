const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const expoRequire = createRequire(require.resolve("expo/package.json"));
const file = path.join(path.dirname(expoRequire.resolve("@expo/cli/package.json")), "build/src/start/server/getStaticRenderFunctions.js");
const source = fs.readFileSync(file, "utf8");
const before = "return await fn.apply(this, props);";
// shortcut: Expo CLI 58 clears lazy SSR dependencies on hot reload; remove when upstream refreshes the renderer before use.
const after = `const renderFunction = !isExporting && (key === 'resolveMetadata' || key === 'getStreamingContent')
                    ? evalMetroNoHandling(projectRoot, script, filename, sourceMap)[key]
                    : fn;
                return await renderFunction.apply(this, props);`;
if (!source.includes(after)) {
  assert.equal(source.split(before).length, 2, "Expo SSR changed; review scripts/patch-expo-ssr.cjs before applying it.");
  fs.writeFileSync(file, source.replace(before, after));
  console.log("Patched Expo dev SSR to refresh lazy renderer dependencies before use.");
}
