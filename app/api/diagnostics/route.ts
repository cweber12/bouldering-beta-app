/**
 * Dev-only detection-diagnostics sink.
 *
 * Appends one JSON line per scan / route-photo match to a gitignored local file
 * (`diagnostics/scans.jsonl` or `diagnostics/matches.jsonl`) so detection
 * quality can be trended on the developer's own machine during tuning. This is
 * deliberately NOT server telemetry — see
 * `docs/adr/0006-dev-local-detection-diagnostics.md`. The route no-ops with a
 * 404 outside development, where the filesystem is read-only anyway.
 */

import { NextRequest, NextResponse } from "next/server";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/** Directory (relative to cwd) the JSONL files are appended to. */
const DIAGNOSTICS_DIR = path.join(process.cwd(), "diagnostics");

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Dev-local only: never collect records in production or preview builds.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let record: { recordType?: unknown };
  try {
    record = (await request.json()) as { recordType?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const file =
    record.recordType === "scan"
      ? "scans.jsonl"
      : record.recordType === "match"
        ? "matches.jsonl"
        : null;
  if (!file) {
    return NextResponse.json(
      { error: "Body must include recordType 'scan' or 'match'." },
      { status: 400 },
    );
  }

  try {
    await mkdir(DIAGNOSTICS_DIR, { recursive: true });
    await appendFile(path.join(DIAGNOSTICS_DIR, file), JSON.stringify(record) + "\n", "utf8");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/diagnostics] append failed:", err);
    return NextResponse.json({ error: "Failed to append diagnostics record." }, { status: 500 });
  }
}
