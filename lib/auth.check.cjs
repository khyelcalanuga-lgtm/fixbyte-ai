// Run: node lib/auth.check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.transpileModule(fs.readFileSync("lib/auth.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

function load(googleModule) {
  const module = { exports: {} };
  let imports = 0;
  let credential;
  const auth = {
    getAuth: () => ({}),
    GoogleAuthProvider: class { static credential(token) { return token; } },
    signInWithCredential: async (_auth, token) => { credential = token; },
  };
  const modules = {
    "react-native": { Platform: { OS: "android" }, TurboModuleRegistry: { get: () => googleModule && {} } },
    "@react-native-async-storage/async-storage": {},
    "firebase/app": { getApps: () => [], initializeApp: () => ({}) },
    "firebase/auth": auth,
  };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    process: { env: { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "test-id" } },
    require(name) {
      if (name === "@react-native-google-signin/google-signin") {
        imports++;
        if (!googleModule) throw new Error("'RNGoogleSignin' could not be found");
        return googleModule;
      }
      if (!(name in modules)) throw new Error(`Unexpected import: ${name}`);
      return modules[name];
    },
  });
  return { api: module.exports, getImports: () => imports, getCredential: () => credential };
}

(async () => {
  const missing = load(null);
  assert.equal(missing.getImports(), 0, "loading auth must not load the native module");
  missing.api.googleSignOut();
  await assert.rejects(missing.api.googleSignIn(), (e) => e.code === "auth/google-unavailable");
  await assert.rejects(missing.api.deleteAccount({ providerData: [{ providerId: "google.com" }] }, ""),
    (e) => e.code === "auth/google-unavailable");
  assert.equal(missing.getImports(), 0, "missing native code must never load the package");
  assert.match(missing.api.authMessage({ code: "auth/google-unavailable" }), /Expo Go/);

  const present = load({ GoogleSignin: {
    configure: () => {}, hasPlayServices: async () => {},
    signIn: async () => ({ type: "success", data: { idToken: "token" } }),
  } });
  await present.api.googleSignIn();
  assert.equal(present.getImports(), 1);
  assert.equal(present.getCredential(), "token", "native sign-in must hand the token to Firebase");
  console.log("auth.check: all passed");
})().catch((e) => { console.error(e); process.exitCode = 1; });
