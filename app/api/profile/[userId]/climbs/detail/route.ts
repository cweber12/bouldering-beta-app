import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import type { Readable } from "stream";
import {
  s3,
  S3_PREFIX,
  getBucket,
  getAuthUserId,
  isValidRoutePrefix,
  awsErrorMessage,
} from "../../../../s3/shared";
import { attemptTimestampLabel, parseRunType } from "@/utils/fsHelpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClimbDetail {
  key: string;
  state: string;
  area: string;
  route: string;
  runType: string;
  timestamp: string;
  rating?: string;
  notes?: string;
  thumbnail?: string;
  coordinates?: { lat: number; lng: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse state/area/route/filename from S3 key. */
function parseKey(key: string): { state: string; area: string; route: string; filename: string } | null {
  const parts = key.split("/");
  if (parts.length < 6) return null;
  return { state: parts[2], area: parts[3], route: parts[4], filename: parts[parts.length - 1] };
}

// ---------------------------------------------------------------------------
// GET — fetch a single climb's detail by S3 key
//
// Query params:
//   key — the full S3 key for the climb JSON
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const authUserId = await getAuthUserId();
  if (!authUserId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { userId } = await params;
  if (!userId || userId.includes("..") || userId.includes("/") || userId.length > 128) {
    return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key parameter." }, { status: 400 });
  }

  // Validate the key belongs to the specified user's RouteData.
  const expectedPrefix = `${S3_PREFIX}/${userId}/`;
  if (
    key.length > 1024 ||
    !key.endsWith(".json") ||
    key.includes("..") ||
    !key.startsWith(expectedPrefix)
  ) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }

  if (!isValidRoutePrefix(`${S3_PREFIX}/${userId}`, userId)) {
    return NextResponse.json({ error: "Invalid prefix." }, { status: 400 });
  }

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  try {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const res = await s3.send(cmd);
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as Readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    const obj = JSON.parse(text) as Record<string, unknown>;

    const parsed = parseKey(key);
    if (!parsed) {
      return NextResponse.json({ error: "Could not parse key." }, { status: 400 });
    }

    const coords = obj.coordinates as { lat?: number; lng?: number } | undefined;

    const detail: ClimbDetail = {
      key,
      state: parsed.state,
      area: parsed.area,
      route: parsed.route,
      runType: parseRunType(parsed.filename),
      timestamp: attemptTimestampLabel(parsed.filename),
      rating: typeof obj.rating === "string" ? obj.rating : undefined,
      notes: typeof obj.notes === "string" ? obj.notes : undefined,
      thumbnail: typeof obj.thumbnail === "string" ? obj.thumbnail : undefined,
      coordinates:
        coords && typeof coords.lat === "number" && typeof coords.lng === "number"
          ? { lat: coords.lat, lng: coords.lng }
          : undefined,
    };

    return NextResponse.json(detail);
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[climbs/detail]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
