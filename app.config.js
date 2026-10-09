const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = ({ config }) => {
  return withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = "false";
    return mod;
  });
};
