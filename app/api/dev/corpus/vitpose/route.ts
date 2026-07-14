/**
 * Dev-only ViTPose scaffold — start a job and read back its artifact.
 *
 * POST forwards the Climber selection to the external downloader's ViTPose
 * endpoint (server-to-server, no CORS) to kick off an async job that tracks the
 * Climber and writes `vitpose.json` into the bundle. GET reads that artifact
 * back from the bundle, returning null while the job is still running. The
 * downloader owns the pose pipeline; beta-scanner only triggers and consumes it
 * (ADR 0019). 404s outside development. See docs/adr/0017-0019.
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
import { parseViTPoseScaffold } from "@/utils/harnessViTPose";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const dir = resolveBundleDir(request.nextUrl.searchParams.get("key") ?? "");
  if (!dir) {
    return NextResponse.json({ error: "Invalid bundle key." }, { status: 400 });
  }

  try {
    const raw = await readFile(path.join(dir, "vitpose.json"), "utf8");
    const scaffold = parseViTPoseScaffold(JSON.parse(raw));
    if (!scaffold) {
      return NextResponse.json({ error: "Malformed vitpose.json." }, { status: 422 });
    }
    return NextResponse.json({ vitpose: scaffold });
  } catch {
    // No artifact yet (job still running, or never started) — not an error.
    return NextResponse.json({ vitpose: null });
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.videoPath !== "string" || b.videoPath.length === 0) {
    return NextResponse.json({ error: "videoPath is required." }, { status: 422 });
  }

  try {
    const res = await fetch(`${base}/api/vitpose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_path: b.videoPath,
        route_folder: parsed.routeFolder,
        video_key: parsed.videoKey,
        climber_point: b.climberPoint,
        climber_crop: b.climberCrop,
        wall_crop: b.wallCrop,
        panning: b.panning,
      }),
    });
    // Pass the downloader's response straight through (202 accepted / 4xx).
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    console.error("[api/dev/corpus/vitpose] relay failed:", err);
    return NextResponse.json({ error: "Failed to reach the downloader API." }, { status: 502 });
  }
}
