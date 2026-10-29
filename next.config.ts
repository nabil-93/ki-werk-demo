import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Kein Dev-Overlay-Badge während der Präsentation
  devIndicators: false,
  reactStrictMode: true,
  // Typprüfung läuft separat (npm run typecheck) – hält den Produktions-Build schnell
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
