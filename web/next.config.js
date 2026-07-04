const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Avoids Next inferring an unrelated lockfile elsewhere on this machine as the
  // workspace root — irrelevant on Vercel (only the repo is checked out there),
  // but keeps local builds/dev clean too.
  outputFileTracingRoot: __dirname,
  webpack(config) {
    // The shared kit under ../src uses NodeNext-style imports ("./data.js" pointing
    // at data.ts) so tsx/tsc resolve it for the CLI. Make webpack resolve the same way.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    // ../src imports packages (e.g. @anthropic-ai/sdk) that only exist in THIS
    // project's own node_modules — with Root Directory=web, Vercel never installs
    // one at the repo root. Node's default resolution only walks up from the
    // importing file's own location, which never reaches this directory for files
    // outside web/, so add it explicitly as an always-checked resolve path.
    config.resolve.modules = [...(config.resolve.modules || []), path.resolve(__dirname, "node_modules")];
    return config;
  },
};

module.exports = nextConfig;
