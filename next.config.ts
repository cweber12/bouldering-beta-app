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

  experimental: {
    // `proxy.ts` runs on every request, so Next buffers each request body to let
    // both the proxy and the route handler read it — capped at 10MB by default,
    // and **silently truncated** past that rather than rejected. A truncated body
    // reaches the route as invalid JSON, so `POST /api/dev/detections` answers
    // 400 and the detection run is discarded after the scan has already been
    // paid for. 77 of the 400 runs in the corpus exceed 10MB (largest 19.4MB),
    // so a batch sweep loses roughly one run in five to this.
    //
    // Sized for the largest plausible run rather than today's maximum: a
    // detection payload scales with video length, and this is a ceiling on
    // buffering, not an allocation.
    proxyClientMaxBodySize: "64mb",
  },

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
