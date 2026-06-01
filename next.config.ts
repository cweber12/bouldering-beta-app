import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use Turbopack (default in Next.js 15+). The empty turbopack block silences
  // the "custom webpack config detected" warning while keeping zero custom
  // webpack configuration.
  turbopack: {},

  // Keep firebase-admin as an external server-side package so Next.js does not
  // attempt to bundle the Node.js Admin SDK (which contains native modules and
  // is not compatible with the Edge runtime or browser bundles).
  serverExternalPackages: ["firebase-admin"],

  // The /view and /match routes were consolidated into the /compare climb
  // console. Redirect stale links — the query string (?key=…) is preserved
  // automatically, and the console reads ?key= as a single-climb alias.
  async redirects() {
    return [
      { source: "/view", destination: "/compare", permanent: true },
      { source: "/match", destination: "/compare", permanent: true },
    ];
  },
};

export default nextConfig;
