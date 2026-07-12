/**
 * Dev-only detection-run relay.
 *
 * Forwards one Test Video detection run (video_path + pose + orb) to the external
 * downloader's POST /api/detections, server-to-server, so the browser page never
 * crosses an origin boundary (no CORS). Pass-through of the downloader's status
 * and body. 404s outside development. See docs/adr/0017.
 */

import { NextRequest, NextResponse } from "next/server";
import { HARNESS_ENABLED, harnessApiBase } from "@/app/api/dev/shared";

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
