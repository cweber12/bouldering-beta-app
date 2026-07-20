/**
 * Dev-only Video Stats — trigger the harness computation and read the artifact.
 *
 * POST relays to the external downloader's synchronous `POST /api/video-stats`
 * (server-to-server, no CORS): the harness decodes ~30 sampled frames using the
 * bundle's just-saved `setup.json` crops, writes `video-stats.json` stamped with
 * the `setupHash` it computed under, and responds with region stats plus
 * suggested condition labels. The scanner never writes the artifact — a
 * recalibration simply re-POSTs and the harness overwrites and re-stamps. GET
 * reads `video-stats.json` back from the bundle (for the asynchronous ViTPose
 * camera-angle hint). 404s outside development. See the video-stats handoff
 * (`.scratch/video-stats-prefill`).
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  HARNESS_ENABLED,
  harnessApiBase,
  parseBundleKey,
  resolveBundleDir,
} from "@/app/api/dev/shared";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const dir = resolveBundleDir(request.nextUrl.searchParams.get("key") ?? "");
  if (!dir) {
    return NextResponse.json({ error: "Invalid bundle key." }, { status: 400 });
  }

  try {
    const raw = await readFile(path.join(dir, "video-stats.json"), "utf8");
    return NextResponse.json({ videoStats: JSON.parse(raw) as unknown });
  } catch {
    // Not computed yet (or unreadable) — an empty hint, not an error.
    return NextResponse.json({ videoStats: null });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const key = request.nextUrl.searchParams.get("key") ?? "";
  const parsed = parseBundleKey(key);
  if (!parsed || !resolveBundleDir(key)) {
    return NextResponse.json({ error: "Invalid bundle key." }, { status: 400 });
  }

  const base = harnessApiBase();
  if (!base) {
    return NextResponse.json({ error: "HARNESS_API_BASE is not configured." }, { status: 400 });
  }

  // The body is optional: the minimal call is just the two identifiers and the
  // harness falls back to the bundle's saved setup.json for everything else.
  // Only the provenance anchor is forwarded when the client supplies it.
  let setupHash: string | undefined;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.setupHash === "string" && body.setupHash.length > 0) {
      setupHash = body.setupHash;
    }
  } catch {
    // No/invalid body — fine, identifiers alone are a valid request.
  }

  try {
    const res = await fetch(`${base}/api/video-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        route_folder: parsed.routeFolder,
        video_key: parsed.videoKey,
        ...(setupHash ? { setup_hash: setupHash } : {}),
      }),
      // Synchronous on the harness (frame decode + stats) — allow it to finish.
      signal: AbortSignal.timeout(30_000),
    });
    // Pass the harness response straight through (200 stats / 4xx / 500).
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    console.error("[api/dev/corpus/video-stats] relay failed:", err);
    return NextResponse.json({ error: "Failed to reach the harness API." }, { status: 502 });
  }
}
