/**
 * Dev-only build identity for the detector.
 *
 * Answers the pair a detection run is stamped with: `appVersion` (the git SHA
 * the dev server was started from, frozen at start by Next) and
 * `detectorCodeHash` (a content hash of the detector modules as they are on
 * disk *now*). The scan path reads this once per run so a hot reload can no
 * longer move the code without moving the stamp, and the harness page reads it
 * so a human can compare it against the last run before spending a batch.
 *
 * Read fresh on every request — never cached, and the client must ask with
 * `cache: "no-store"`. A cached hash is a frozen stamp with extra steps.
 * 404s outside development, like the rest of `/api/dev`.
 */

import { NextResponse } from "next/server";
import { HARNESS_ENABLED } from "@/app/api/dev/shared";
import { computeDetectorCodeHash } from "@/app/api/dev/detectorSources";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const detectorCodeHash = await computeDetectorCodeHash();
    return NextResponse.json(
      {
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
        detectorCodeHash,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    // A partial digest would look valid while describing the wrong code, so a
    // read failure surfaces as an error and the run posts with no hash at all.
    console.error("[api/dev/detector-hash] hash failed:", err);
    return NextResponse.json({ error: "Failed to hash the detector sources." }, { status: 500 });
  }
}
