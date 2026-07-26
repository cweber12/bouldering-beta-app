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
  readSetupHash,
} from "@/app/api/dev/shared";
import { parseViTPoseScaffold } from "@/utils/harnessViTPose";
import { scaffoldIsStale } from "@/utils/harnessFreshness";

/** The status sidecar the downloader writes alongside (or instead of) the artifact. */
const STATUS_FILE = "vitpose.status.json";

interface JobStatusInfo {
  /** The sidecar's raw `status` value (`running` / `done` / `error`), or null. */
  status: string | null;
  /** Terminal failure message when `status === "error"`, else null. */
  error: string | null;
  /** Non-fatal downloader advisories for the run (e.g. a legacy tap without a
   * timestamp, or an ambiguous `t=0` tap) — surfaced even on a successful run. */
  warnings: string[];
  /** `seedDebug.seedFound`: false when the tracker ran but matched no person to
   * the Climber tap — the artifact lands with every frame poseless. Null when
   * the sidecar (or the field) is absent. */
  seedFound: boolean | null;
}

/**
 * Read the job's status sidecar. The downloader writes `vitpose.status.json`
 * with `status: "error"` (and a message) when a job dies *after* being accepted
 * — the only failure signal the poller would otherwise never see, since no
 * `vitpose.json` is ever written. A successful run may still attach `warnings`
 * about the Climber selection (missing/ambiguous tap timestamp) alongside its
 * `done` status (ADR 0019).
 */
async function readJobStatus(dir: string): Promise<JobStatusInfo> {
  try {
    const raw = await readFile(path.join(dir, STATUS_FILE), "utf8");
    const status = JSON.parse(raw) as Record<string, unknown>;
    const warnings = Array.isArray(status.warnings)
      ? status.warnings.filter((w): w is string => typeof w === "string" && w.length > 0)
      : [];
    const error =
      status.status === "error"
        ? typeof status.error === "string" && status.error
          ? status.error
          : "The ViTPose job failed."
        : null;
    const seedDebug =
      typeof status.seedDebug === "object" && status.seedDebug !== null
        ? (status.seedDebug as Record<string, unknown>)
        : null;
    return {
      status: typeof status.status === "string" ? status.status : null,
      error,
      warnings,
      seedFound: typeof seedDebug?.seedFound === "boolean" ? seedDebug.seedFound : null,
    };
  } catch {
    // No status sidecar / unreadable → treat as still running, no advisories.
    return { status: null, error: null, warnings: [], seedFound: null };
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
    // The freshness gate (harness issue #21): an artifact stamped under an older
    // calibration must never be served as the seed — exporting truth from it
    // stamps a hash no run under the current setup can pair with. While a fresh
    // job is running the stale artifact reads as "not landed yet"; otherwise it
    // is a terminal condition the author fixes by re-running ViTPose.
    const currentSetupHash = await readSetupHash(dir);
    if (scaffoldIsStale(scaffold.setupHash, currentSetupHash)) {
      const { status, warnings, seedFound } = await readJobStatus(dir);
      const error =
        status === "running"
          ? null
          : "The ViTPose scaffold is from an older calibration — re-run ViTPose.";
      return NextResponse.json({ vitpose: null, error, warnings, seedFound });
    }
    // A written artifact supersedes any stale error from an earlier run, but the
    // current run's own sidecar may carry advisories about the seed selection —
    // and its seedFound flag, which tells a poseless artifact's cause (tap
    // matched no track) from a genuine tracker miss.
    const { warnings, seedFound } = await readJobStatus(dir);
    return NextResponse.json({ vitpose: scaffold, warnings, seedFound });
  } catch {
    // No artifact yet — either the job is still running, or it failed after
    // being accepted. Surface a terminal error so authoring can be gated, plus
    // any advisories the downloader has already attached.
    const { error, warnings, seedFound } = await readJobStatus(dir);
    return NextResponse.json({ vitpose: null, error, warnings, seedFound });
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

  // Climb window (harness ADR 0007 §3). Both bounds are optional and independent
  // — the harness falls back to the bundle's setup.json for whichever is absent,
  // so an unmarked Bundle must send neither rather than sending null. Checked
  // here against the endpoint's own rule (end > start, both >= 0) so a bad window
  // costs a 422 instead of a submitted job that dies downstream.
  const climbStart = b.climbStart;
  const climbEnd = b.climbEnd;
  const validBound = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (climbStart !== undefined && !validBound(climbStart)) {
    return NextResponse.json({ error: "climbStart must be a time in seconds." }, { status: 422 });
  }
  if (climbEnd !== undefined && !validBound(climbEnd)) {
    return NextResponse.json({ error: "climbEnd must be a time in seconds." }, { status: 422 });
  }
  if (validBound(climbStart) && validBound(climbEnd) && climbEnd <= climbStart) {
    return NextResponse.json(
      { error: "climbEnd must be after climbStart." },
      { status: 422 },
    );
  }

  // Clear the prior run's terminal status AND its artifact so the poller can
  // only ever see output of the fresh job — leaving an old vitpose.json in
  // place is what let a re-calibration's export seed from the previous
  // calibration's scaffold (the export race, harness issue #21). Best-effort.
  await rm(path.join(dir, STATUS_FILE), { force: true }).catch(() => {});
  await rm(path.join(dir, "vitpose.json"), { force: true }).catch(() => {});

  try {
    const res = await fetch(`${base}/api/vitpose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_path: b.videoPath,
        route_folder: parsed.routeFolder,
        video_key: parsed.videoKey,
        // The Seed tap + its derived acquisition region are the seed contract
        // now (harness-setup-calibrate-split downloader handoff). `climber_point`
        // is kept as a legacy alias so a downloader that has not yet migrated to
        // `seed_tap` / `seed_region` still seeds from the same point; the crops
        // ride along for parity but no longer gate the seed.
        seed_tap: b.seedTap,
        seed_region: b.seedRegion,
        climber_point: b.seedTap,
        climber_crop: b.climberCrop,
        wall_crop: b.wallCrop,
        panning: b.panning,
        frames: b.frames,
        // Omitted rather than nulled when unknown: the harness reads the missing
        // bound off the bundle's setup.json, and an explicit null would override
        // that fallback with nothing.
        ...(climbStart !== undefined ? { climb_start: climbStart } : {}),
        ...(climbEnd !== undefined ? { climb_end: climbEnd } : {}),
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
