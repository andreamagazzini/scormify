import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packager resolves XSD paths from its package directory; bundling breaks __dirname.
  serverExternalPackages: ["simple-scorm-packager"],
  // Ship `public/sco-runtime.js` inside the /api/export server bundle (not symlinked; safe for Vercel).
  // Do NOT add `node_modules/**` globs here—pnpm’s symlinked store breaks the serverless zip with:
  // "invalid deployment package ... symlinked directories". Rely on `serverExternalPackages` + hoisted .npmrc.
  outputFileTracingIncludes: {
    "/app/api/export": ["public/sco-runtime.js"],
  },
};

export default nextConfig;
