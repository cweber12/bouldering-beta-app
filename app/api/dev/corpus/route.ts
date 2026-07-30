/**
 * Dev-only test-corpus listing.
 *
 * Enumerates the external downloader's Test Video bundles (see docs/adr/0017)
 * so the harness page can show which videos are calibrated vs pending. Reads the
 * local `analysis/` folder directly from disk — the downloader stays write-only
 * for detections. 404s outside development.
 *
 * Also carries the current `detectorCodeHash` so the corpus page can show the
 * build identity a batch is about to be spent under, without running a scan.
 * A failure to hash must not take out the listing — the field goes null and the
 * page shows it as unavailable.
 */

import { NextResponse } from "next/server";
import { HARNESS_ENABLED, analysisRoot, listCorpus } from "@/app/api/dev/shared";
import { computeDetectorCodeHash } from "@/app/api/dev/detectorSources";

export async function GET(): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!analysisRoot()) {
    return NextResponse.json(
      { error: "HARNESS_ANALYSIS_ROOT is not configured." },
      { status: 400 },
    );
  }

  try {
    const [items, detectorCodeHash] = await Promise.all([
      listCorpus(),
      computeDetectorCodeHash().catch((err) => {
        console.error("[api/dev/corpus] detector hash failed:", err);
        return null;
      }),
    ]);
    return NextResponse.json(
      { items, appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev", detectorCodeHash },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/dev/corpus] list failed:", err);
    return NextResponse.json({ error: "Failed to list corpus." }, { status: 500 });
  }
}
