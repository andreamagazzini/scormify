import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packager resolves XSD paths from its package directory; bundling breaks __dirname.
  serverExternalPackages: ["simple-scorm-packager"],
  // Ensure the serverless bundle includes files the packager and export path need at runtime
  // (Vercel trace can miss optional/deep paths; key matches normalized route `/app/api/export`).
  outputFileTracingIncludes: {
    "/app/api/export": [
      "public/sco-runtime.js",
      "node_modules/simple-scorm-packager/**/*",
      "node_modules/archiver/**/*",
      "node_modules/jsdom/**/*",
    ],
  },
};

export default nextConfig;
