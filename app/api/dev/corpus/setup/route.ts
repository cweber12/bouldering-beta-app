/**
 * Dev-only Scan Setup read/write.
 *
 * GET returns a Test Video's calibrated Scan Setup (or null); PUT validates and
 * writes it as `setup.json` into the bundle, re-computing `setupHash` server-side
 * so the hash is authoritative. The bundle must already exist. 404s outside
 * development. See docs/adr/0017 and the Scan Setup glossary entry.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { HARNESS_ENABLED, resolveBundleDir } from "@/app/api/dev/shared";
import {
  parseScanSetupInput,
  hashSetupInput,
  SETUP_VERSION,
  type ScanSetup,
} from "@/utils/harnessSetup";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const dir = resolveBundleDir(request.nextUrl.searchParams.get("key") ?? "");
  if (!dir) {
    return NextResponse.json({ error: "Invalid bundle key." }, { status: 400 });
  }

  try {
    const raw = await readFile(path.join(dir, "setup.json"), "utf8");
    return NextResponse.json({ setup: JSON.parse(raw) });
  } catch {
    // No setup yet (or unreadable) — treat as un-calibrated.
    return NextResponse.json({ setup: null });
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

  const input = parseScanSetupInput(body);
  if (!input) {
    return NextResponse.json({ error: "Invalid Scan Setup." }, { status: 422 });
  }

  const setup: ScanSetup = {
    version: SETUP_VERSION,
    ...input,
    setupHash: await hashSetupInput(input),
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
