/**
 * Dev-only test-corpus listing.
 *
 * Enumerates the external downloader's Test Video bundles (see docs/adr/0017)
 * so the harness page can show which videos are calibrated vs pending. Reads the
 * local `analysis/` folder directly from disk — the downloader stays write-only
 * for detections. 404s outside development.
 */

import { NextResponse } from "next/server";
import { HARNESS_ENABLED, analysisRoot, listCorpus } from "@/app/api/dev/shared";

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
    const items = await listCorpus();
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[api/dev/corpus] list failed:", err);
    return NextResponse.json({ error: "Failed to list corpus." }, { status: 500 });
  }
}
