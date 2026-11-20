import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Next.js blocks dev assets (HMR, client chunks) from origins other than the
 * one it booted on. Without this, opening the app via 127.0.0.1 or a LAN IP
 * leaves the page unhydrated, so the login form falls back to a native GET and
 * puts the password in the URL.
 */
const devOrigins = new Set(["localhost", "127.0.0.1", "[::1]"]);
for (const iface of Object.values(os.networkInterfaces())) {
  for (const addr of iface ?? []) {
    if (addr.family === "IPv4" && !addr.internal) devOrigins.add(addr.address);
  }
}

const onVercel = Boolean(process.env.VERCEL);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Standalone is for Docker/Node hosts. Vercel uses its own Next output — leave unset there.
  ...(onVercel ? {} : { output: "standalone" as const }),
  allowedDevOrigins: [...devOrigins],
  // Monorepo root has package-lock.json — pin Turbopack to web/ so deps resolve correctly.
  turbopack: {
    root: webRoot,
  },
};

export default nextConfig;
