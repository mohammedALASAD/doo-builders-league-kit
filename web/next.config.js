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
    return config;
  },
};

module.exports = nextConfig;
