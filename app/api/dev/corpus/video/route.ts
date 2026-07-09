/**
 * Dev-only Test Video streaming.
 *
 * Serves a bundle's mp4 to the harness page so the browser pipeline can decode
 * it (the downloader stays write-only for detections). The whole file is read
 * and returned — Test clips are short and this is a single-machine dev tool, so
 * range requests are unnecessary; an object URL over the full blob still seeks.
 * 404s outside development. See docs/adr/0017.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { HARNESS_ENABLED, resolveBundleDir, parseBundleKey } from "@/app/api/dev/shared";

export async function GET(request: NextRequest): Promise<Response> {
  if (!HARNESS_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const key = request.nextUrl.searchParams.get("key") ?? "";
  const dir = resolveBundleDir(key);
  const parsed = parseBundleKey(key);
  if (!dir || !parsed) {
    return NextResponse.json({ error: "Invalid bundle key." }, { status: 400 });
  }

  try {
    // Convention: the video file is named `<videoKey>.mp4`. Fall back to the
    // first .mp4 in the bundle if the name differs.
    let buf: Buffer;
    try {
      buf = await readFile(path.join(dir, `${parsed.videoKey}.mp4`));
    } catch {
      const mp4 = (await readdir(dir)).find((f) => f.toLowerCase().endsWith(".mp4"));
      if (!mp4) {
        return NextResponse.json({ error: "No video in bundle." }, { status: 404 });
      }
      buf = await readFile(path.join(dir, mp4));
    }

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/dev/corpus/video] read failed:", err);
    return NextResponse.json({ error: "Failed to read video." }, { status: 500 });
  }
}
