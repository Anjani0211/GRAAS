import path from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  output: "standalone",
  // Monorepo root has package-lock.json — pin Turbopack to web/ so deps resolve correctly.
  turbopack: {
    root: webRoot,
  },
};

export default nextConfig;
