/**
 * Dev-only Ground Truth read/write.
 *
 * GET returns a Test Video's Ground Truth (or null); PUT validates and writes it
 * as `ground-truth.json` into the bundle, re-computing `groundTruthHash`
 * server-side so the hash is authoritative and stamping the core joint-set
 * definition. The bundle must already exist. 404s outside development. See
 * docs/adr/0018 and the Ground Truth glossary entry.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { HARNESS_ENABLED, resolveBundleDir } from "@/app/api/dev/shared";
import {
  parseGroundTruthInput,
  hashGroundTruthInput,
  GROUND_TRUTH_VERSION,
  CORE_JOINT_NAMES,
  type GroundTruth,
} from "@/utils/harnessGroundTruth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const dir = resolveBundleDir(request.nextUrl.searchParams.get("key") ?? "");
  if (!dir) {
    return NextResponse.json({ error: "Invalid bundle key." }, { status: 400 });
  }

  try {
    const raw = await readFile(path.join(dir, "ground-truth.json"), "utf8");
    return NextResponse.json({ groundTruth: JSON.parse(raw) });
  } catch {
    // No Ground Truth yet (or unreadable) — treat as un-authored.
    return NextResponse.json({ groundTruth: null });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const dir = resolveBundleDir(request.nextUrl.searchParams.get("key") ?? "");
  if (!dir) {
    return NextResponse.json({ error: "Invalid bundle key." }, { status: 400 });
  }

  // Ground Truth only makes sense for a real Test Video bundle.
  try {
    await access(path.join(dir, "metadata.json"));
  } catch {
    return NextResponse.json({ error: "No such Test Video bundle." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = parseGroundTruthInput(body);
  if (!input) {
    return NextResponse.json({ error: "Invalid Ground Truth." }, { status: 422 });
  }

  const groundTruth: GroundTruth = {
    version: GROUND_TRUTH_VERSION,
    jointSet: CORE_JOINT_NAMES,
    ...input,
    groundTruthHash: await hashGroundTruthInput(input),
    updatedAt: new Date().toISOString(),
  };

  try {
    await writeFile(
      path.join(dir, "ground-truth.json"),
      JSON.stringify(groundTruth, null, 2),
      "utf8",
    );
    return NextResponse.json({ groundTruth });
  } catch (err) {
    console.error("[api/dev/corpus/ground-truth] write failed:", err);
    return NextResponse.json({ error: "Failed to write Ground Truth." }, { status: 500 });
  }
}
