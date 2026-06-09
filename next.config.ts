import type { NextConfig } from "next";
import { execSync } from "node:child_process";

/**
 * Short git SHA of the current checkout, resolved once at build/dev-server
 * start and exposed to the app as NEXT_PUBLIC_APP_VERSION. Stamped onto every
 * dev-local diagnostics record so trend analysis can attribute a quality shift
 * to a code change vs. a capture condition. Falls back to "dev" outside git.
 */
function resolveAppVersion(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: resolveAppVersion(),
  },

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
