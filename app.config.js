const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = ({ config }) => {
  // Permit local HTTP only for builds explicitly targeting an HTTP test server.
  const localHttp = process.env.EXPO_PUBLIC_API_URL?.startsWith("http://") ?? false;
  return withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = String(localHttp);
    return mod;
  });
};
