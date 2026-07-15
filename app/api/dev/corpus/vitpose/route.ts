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
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  HARNESS_ENABLED,
  harnessApiBase,
  parseBundleKey,
  resolveBundleDir,
} from "@/app/api/dev/shared";
import { parseViTPoseScaffold } from "@/utils/harnessViTPose";

/** The status sidecar the downloader writes alongside (or instead of) the artifact. */
const STATUS_FILE = "vitpose.status.json";

/**
 * Read a terminal job failure from the status sidecar, or null. The downloader
 * writes `vitpose.status.json` with `status: "error"` (and a message) when a job
 * dies *after* being accepted — the only failure signal the poller would
 * otherwise never see, since no `vitpose.json` is ever written (ADR 0019).
 */
async function readJobError(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(dir, STATUS_FILE), "utf8");
    const status = JSON.parse(raw) as Record<string, unknown>;
    if (status.status !== "error") return null;
    return typeof status.error === "string" && status.error
      ? status.error
      : "The ViTPose job failed.";
  } catch {
    // No status sidecar / unreadable → treat as still running.
    return null;
  }
}

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
    // A written artifact supersedes any stale status from an earlier run.
    return NextResponse.json({ vitpose: scaffold });
  } catch {
    // No artifact yet — either the job is still running, or it failed after
    // being accepted. Surface a terminal error so authoring can be gated.
    const jobError = await readJobError(dir);
    return NextResponse.json({ vitpose: null, error: jobError });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const key = request.nextUrl.searchParams.get("key") ?? "";
  const parsed = parseBundleKey(key);
  const dir = resolveBundleDir(key);
  if (!parsed || !dir) {
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
  if (!Array.isArray(b.frames) || b.frames.length === 0) {
    return NextResponse.json({ error: "frames (non-empty) is required." }, { status: 422 });
  }

  // Clear any prior run's terminal status so the poller can't read a stale
  // failure before the fresh job overwrites its sidecar (best-effort).
  await rm(path.join(dir, STATUS_FILE), { force: true }).catch(() => {});

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
        frames: b.frames,
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
