/**
 * Dev-only harness contract probe relay.
 *
 * GET forwards to the external downloader's `GET /api/contract` (server-to-
 * server, no CORS) and passes the self-description back for the client-side
 * feature gate (`utils/harnessContract`). Any failure — no HARNESS_API_BASE,
 * network error, non-2xx — returns `contract: null` with a reason: the client
 * treats every null identically as the visible degraded state, so this route
 * never needs to distinguish them by status code. 404s outside development.
 */

import { NextResponse } from "next/server";
import { HARNESS_ENABLED, harnessApiBase } from "@/app/api/dev/shared";

export async function GET(): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const base = harnessApiBase();
  if (!base) {
    return NextResponse.json({ contract: null, error: "HARNESS_API_BASE is not configured." });
  }

  try {
    const res = await fetch(`${base}/api/contract`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json({ contract: null, error: `Contract probe returned ${res.status}.` });
    }
    const contract: unknown = await res.json();
    return NextResponse.json({ contract });
  } catch (err) {
    console.error("[api/dev/contract] probe failed:", err);
    return NextResponse.json({ contract: null, error: "Failed to reach the harness API." });
  }
}
