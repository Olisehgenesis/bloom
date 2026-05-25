import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.100.25", "192.168.1.97", "192.168.100.3"],
  // Never let the CDN / browser hold onto an old service worker or manifest.
  // The SW itself decides what to cache; we just make sure we can always
  // ship a new SW without users being stuck on the previous one.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  // Proxy the GoodDollar gas faucet so the client can call it without CORS issues.
  async rewrites() {
    return [
      {
        source: "/api/faucet",
        destination: "https://goodserver.gooddollar.org/verify/topWallet",
      },
    ];
  },
};

export default nextConfig;
