/**
 * Dev-only editable video metadata (`analysis_inputs`).
 *
 * GET returns a Test Video's `analysis_inputs` block (or null); PUT applies a
 * field-level strict merge of the edited labels into the downloader-owned
 * `metadata.json` — only the changed `analysis_inputs.<field>` values are
 * overwritten, every other key (including `route_folder` / `imported_from`) is
 * preserved verbatim. The bundle must already exist. 404s outside development.
 * See docs/adr/0018 §4.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HARNESS_ENABLED, resolveBundleDir } from "@/app/api/dev/shared";
import {
  parseAnalysisInputsEdit,
  mergeMetadataAnalysisInputs,
} from "@/utils/harnessMetadata";

/** Read and JSON-parse a bundle's metadata.json, or null when missing/invalid. */
async function readMetadata(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
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

  const meta = await readMetadata(dir);
  if (!meta) {
    return NextResponse.json({ error: "No such Test Video bundle." }, { status: 404 });
  }
  return NextResponse.json({ analysisInputs: meta.analysis_inputs ?? null });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const dir = resolveBundleDir(request.nextUrl.searchParams.get("key") ?? "");
  if (!dir) {
    return NextResponse.json({ error: "Invalid bundle key." }, { status: 400 });
  }

  // The merge target must be a real Test Video bundle we can read back.
  const meta = await readMetadata(dir);
  if (!meta) {
    return NextResponse.json({ error: "No such Test Video bundle." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const edit = parseAnalysisInputsEdit(body);
  if (!edit) {
    return NextResponse.json({ error: "Invalid metadata edit." }, { status: 422 });
  }

  const merged = mergeMetadataAnalysisInputs(meta, edit);
  try {
    await writeFile(
      path.join(dir, "metadata.json"),
      JSON.stringify(merged, null, 2),
      "utf8",
    );
    return NextResponse.json({ analysisInputs: merged.analysis_inputs ?? null });
  } catch (err) {
    console.error("[api/dev/corpus/metadata] write failed:", err);
    return NextResponse.json({ error: "Failed to write metadata." }, { status: 500 });
  }
}
