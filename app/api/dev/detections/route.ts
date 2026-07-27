/**
 * Dev-only detection-run relay (write) and reader (read).
 *
 * POST forwards one Test Video detection run (video_path + pose + orb) to the
 * external downloader's POST /api/detections, server-to-server, so the browser
 * page never crosses an origin boundary (no CORS). Pass-through of the
 * downloader's status and body.
 *
 * GET reads runs back off the **local** corpus, the way the sibling setup /
 * ground-truth / vitpose routes read theirs — not by relaying to the downloader.
 * The runs the downloader wrote are already durable under
 * `HARNESS_ANALYSIS_ROOT`, and reviewing past evidence must not require
 * `HARNESS_API_BASE` to be up. Two shapes on the one route:
 *
 * - `?key=<bundleKey>` — the Bundle's runs, newest first, with the stamps and
 *   verdict counts needed to pick one. Never frames or detector attempts.
 * - `?key=<bundleKey>&run=<runTs>` — that run's full `HarnessPosePayload`.
 *
 * 404s outside development. See docs/adr/0017.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  HARNESS_ENABLED,
  harnessApiBase,
  resolveBundleDir,
  detectionsDir,
  listRunFiles,
  readRunFacts,
  isSafeSegment,
  readSetupHash,
} from "@/app/api/dev/shared";
import { runPairsWithTruth } from "@/utils/harnessFreshness";
import { parseRunFile, type HarnessRunSummary } from "@/utils/harnessRuns";

/** The bundle's Ground Truth `setupHash`, or null when it has no truth. */
async function readTruthSetupHash(bundleDir: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(bundleDir, "ground-truth.json"), "utf8"),
    ) as Record<string, unknown>;
    return typeof parsed.setupHash === "string" && parsed.setupHash.length > 0
      ? parsed.setupHash
      : "";
  } catch {
    return null; // no truth at all — nothing for a run to pair with
  }
}

/** The Bundle's runs, newest first, with pairing resolved against its truth. */
async function listBundleRuns(bundleDir: string): Promise<HarnessRunSummary[]> {
  const refs = await listRunFiles(detectionsDir(bundleDir));
  if (refs.length === 0) return [];

  const [truthSetupHash, setupHash] = await Promise.all([
    readTruthSetupHash(bundleDir),
    readSetupHash(bundleDir),
  ]);

  const runs: HarnessRunSummary[] = [];
  for (const ref of refs) {
    const facts = await readRunFacts(ref);
    runs.push({
      runTs: ref.runTs,
      ...facts,
      // A truthless Bundle pairs nothing — same rule the corpus counts use.
      pairsWithTruth:
        truthSetupHash !== null &&
        runPairsWithTruth(facts.setupHash, truthSetupHash, setupHash),
    });
  }
  return runs;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const dir = resolveBundleDir(request.nextUrl.searchParams.get("key") ?? "");
  if (!dir) {
    return NextResponse.json({ error: "Invalid bundle key." }, { status: 400 });
  }

  const runTs = request.nextUrl.searchParams.get("run");
  if (runTs === null) {
    return NextResponse.json({ runs: await listBundleRuns(dir) });
  }

  // The run identifier reaches the filesystem as a file name — same containment
  // rules as a bundle key segment.
  if (!isSafeSegment(runTs)) {
    return NextResponse.json({ error: "Invalid run identifier." }, { status: 400 });
  }

  let raw: string;
  try {
    raw = await readFile(path.join(detectionsDir(dir), `${runTs}_pose.json`), "utf8");
  } catch {
    return NextResponse.json({ error: "No such detection run." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "The run file is not valid JSON — it may be truncated." },
      { status: 422 },
    );
  }

  const parsed = parseRunFile(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 422 });
  }
  return NextResponse.json({ run: parsed.payload });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
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
  if (
    typeof b.video_path !== "string" ||
    b.video_path.length === 0 ||
    b.pose === undefined ||
    b.orb === undefined
  ) {
    return NextResponse.json(
      { error: "video_path (non-empty), pose, and orb are required." },
      { status: 422 },
    );
  }

  try {
    const res = await fetch(`${base}/api/detections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_path: b.video_path, pose: b.pose, orb: b.orb }),
    });
    // Pass the downloader's response straight through so the page sees its
    // status codes (200 / 400 / 404 / 422) and body verbatim.
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    console.error("[api/dev/detections] relay failed:", err);
    return NextResponse.json({ error: "Failed to reach the downloader API." }, { status: 502 });
  }
}
