/**
 * Dev-only Scan Setup read/write.
 *
 * GET returns a Test Video's calibrated Scan Setup (or null); PUT is a merging
 * write of `setup.json` into the bundle. A scan-input (crop) body re-computes
 * `setupHash` server-side and preserves the saved condition labels; a labels-only
 * body (`{ analysisInputs }`) preserves the saved crops and their `setupHash`
 * byte-for-byte — `setupHash` never covers the labels, so a label edit can never
 * orphan saved Ground Truth or prior runs. The bundle must already exist. 404s
 * outside development. See docs/adr/0017 and the Scan Setup glossary entry.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { HARNESS_ENABLED, resolveBundleDir } from "@/app/api/dev/shared";
import { mergeAnalysisInputs, mergeProvenance } from "@/utils/harnessMetadata";
import {
  parseScanSetupInput,
  parseAnalysisInputsEdit,
  parseProvenanceEdit,
  bodyHasScanInputs,
  pickScanInput,
  hashSetupInput,
  SETUP_VERSION,
  type ScanSetup,
  type ScanSetupInput,
} from "@/utils/harnessSetup";

/** Read and JSON-parse a bundle's setup.json, or null when missing/invalid. */
async function readSetup(dir: string): Promise<ScanSetup | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(dir, "setup.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as ScanSetup) : null;
  } catch {
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

  const setup = await readSetup(dir);
  return NextResponse.json({ setup });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const dir = resolveBundleDir(request.nextUrl.searchParams.get("key") ?? "");
  if (!dir) {
    return NextResponse.json({ error: "Invalid bundle key." }, { status: 400 });
  }

  // A Setup only makes sense for a real Test Video bundle.
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

  const existing = await readSetup(dir);

  // Scan-affecting fields: parse fresh crops when the body carries any, else
  // inherit the saved ones. A labels-only body preserves the crops (and hash).
  let input: ScanSetupInput;
  if (bodyHasScanInputs(body)) {
    const parsed = parseScanSetupInput(body);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid Scan Setup." }, { status: 422 });
    }
    input = parsed;
  } else if (existing) {
    input = pickScanInput(existing);
  } else {
    // Labels-only save with nothing to merge onto — crops must be calibrated first.
    return NextResponse.json(
      { error: "Save the Scan Setup before editing labels." },
      { status: 422 },
    );
  }

  // Condition labels: merge an edit onto the saved block, else carry it forward.
  let analysisInputs = mergeAnalysisInputs(existing?.analysisInputs, {});
  if (typeof body === "object" && body !== null && "analysisInputs" in body) {
    const edit = parseAnalysisInputsEdit(body);
    if (!edit) {
      return NextResponse.json({ error: "Invalid condition labels." }, { status: 422 });
    }
    analysisInputs = mergeAnalysisInputs(existing?.analysisInputs, edit);
  }

  // Per-label provenance: same merge semantics as the labels themselves. Like
  // the labels, it never participates in `setupHash`.
  const provenanceEdit = parseProvenanceEdit(body);
  if (!provenanceEdit) {
    return NextResponse.json({ error: "Invalid label provenance." }, { status: 422 });
  }
  const provenance = mergeProvenance(existing?.analysisInputsProvenance, provenanceEdit);

  const setup: ScanSetup = {
    version: SETUP_VERSION,
    ...input,
    setupHash: await hashSetupInput(input),
    ...(Object.keys(analysisInputs).length > 0 ? { analysisInputs } : {}),
    ...(Object.keys(provenance).length > 0 ? { analysisInputsProvenance: provenance } : {}),
    updatedAt: new Date().toISOString(),
  };

  try {
    await writeFile(path.join(dir, "setup.json"), JSON.stringify(setup, null, 2), "utf8");
    return NextResponse.json({ setup });
  } catch (err) {
    console.error("[api/dev/corpus/setup] write failed:", err);
    return NextResponse.json({ error: "Failed to write setup." }, { status: 500 });
  }
}
