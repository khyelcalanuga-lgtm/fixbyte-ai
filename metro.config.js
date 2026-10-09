const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Build and deploy tooling lives in the project folder but isn't app code. Without this, Metro crawls
// their ~20k files (.cloud-tools alone has its own node_modules) and bundling crawls to a halt.
// Anchored to the project root, so packages' own android/ folders in node_modules are untouched.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
config.resolver.blockList = [".cloud-tools", ".android-tools", "android", "dist", "artifacts"].map(
  (dir) => new RegExp(`^${escape(path.join(__dirname, dir))}[\\\\/].*`),
);

module.exports = config;
