import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packager resolves XSD paths from its package directory; bundling breaks __dirname.
  serverExternalPackages: ["simple-scorm-packager"],
};

export default nextConfig;
