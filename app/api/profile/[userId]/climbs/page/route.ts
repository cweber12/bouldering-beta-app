import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
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

export interface ClimbSummary {
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
// GET — paginated climb summaries with thumbnails
//
// Query params:
//   page     — 1-based page number (default 1)
//   pageSize — items per page (default 16, max 16)
//   state    — optional state filter
//   area     — optional area filter
//   route    — optional route filter
//   rating   — optional rating filter (requires JSON fetch)
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

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  const prefix = `${S3_PREFIX}/${userId}`;
  if (!isValidRoutePrefix(prefix, userId)) {
    return NextResponse.json({ error: "Invalid prefix." }, { status: 400 });
  }

  const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(16, Math.max(1, parseInt(request.nextUrl.searchParams.get("pageSize") ?? "16", 10) || 16));
  const filterState = request.nextUrl.searchParams.get("state")?.toLowerCase() ?? "";
  const filterArea = request.nextUrl.searchParams.get("area")?.toLowerCase() ?? "";
  const filterRoute = request.nextUrl.searchParams.get("route")?.toLowerCase() ?? "";
  const filterRating = request.nextUrl.searchParams.get("rating")?.toLowerCase() ?? "";

  try {
    // 1. List all climb JSON keys for this user.
    const allKeys: string[] = [];
    let token: string | undefined;

    do {
      const cmd = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      });
      const res = await s3.send(cmd);
      for (const obj of res.Contents ?? []) {
        if (obj.Key && (obj.Key.match(/run-\d+.*\.json$/) || obj.Key.match(/attempt-\d+\.json$/))) {
          allKeys.push(obj.Key);
        }
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    // 2. Parse keys and apply location filters (from key structure, no JSON fetch).
    interface ParsedKey { key: string; state: string; area: string; route: string; filename: string }
    let parsed: ParsedKey[] = allKeys
      .map((key) => {
        const p = parseKey(key);
        return p ? { key, ...p } : null;
      })
      .filter((p): p is ParsedKey => p !== null);

    if (filterState) parsed = parsed.filter((p) => p.state.toLowerCase().includes(filterState));
    if (filterArea) parsed = parsed.filter((p) => p.area.toLowerCase().includes(filterArea));
    if (filterRoute) parsed = parsed.filter((p) => p.route.toLowerCase().includes(filterRoute));

    // 3. Sort newest first (timestamps are embedded in filenames).
    parsed.sort((a, b) => b.key.localeCompare(a.key));

    // 4. If rating filter is set, we need to fetch JSONs to check rating.
    //    Otherwise we can paginate before fetching.
    if (filterRating) {
      // Fetch up to 500 JSONs to check rating, then filter and paginate.
      const capped = parsed.slice(0, 500);
      const summaries: ClimbSummary[] = [];

      const results = await Promise.all(capped.map((p) => fetchSummary(bucket, p.key, p)));
      for (const s of results) {
        if (!s) continue;
        if (s.rating && s.rating.toLowerCase().includes(filterRating)) {
          summaries.push(s);
        }
      }

      const total = summaries.length;
      const start = (page - 1) * pageSize;
      return NextResponse.json({
        items: summaries.slice(start, start + pageSize),
        total,
        page,
        pageSize,
      });
    }

    // 5. Paginate, then fetch only the page's JSONs for thumbnails/details.
    const total = parsed.length;
    const start = (page - 1) * pageSize;
    const pageKeys = parsed.slice(start, start + pageSize);

    const items = (
      await Promise.all(pageKeys.map((p) => fetchSummary(bucket, p.key, p)))
    ).filter((s): s is ClimbSummary => s !== null);

    return NextResponse.json({ items, total, page, pageSize });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[climbs/page]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// ---------------------------------------------------------------------------
// Fetch a single climb JSON and extract summary fields
// ---------------------------------------------------------------------------

async function fetchSummary(
  bucket: string,
  key: string,
  parsed: { state: string; area: string; route: string; filename: string },
): Promise<ClimbSummary | null> {
  try {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const res = await s3.send(cmd);
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as Readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    const obj = JSON.parse(text) as Record<string, unknown>;

    const coords = obj.coordinates as { lat?: number; lng?: number } | undefined;

    return {
      key,
      state: parsed.state,
      area: parsed.area,
      route: parsed.route,
      runType: parseRunType(parsed.filename),
      timestamp: attemptTimestampLabel(parsed.filename),
      rating: typeof obj.rating === "string" ? obj.rating : undefined,
      notes: typeof obj.notes === "string" ? obj.notes : undefined,
      thumbnail: typeof obj.thumbnail === "string" ? obj.thumbnail : undefined,
      coordinates: coords && typeof coords.lat === "number" && typeof coords.lng === "number"
        ? { lat: coords.lat, lng: coords.lng }
        : undefined,
    };
  } catch {
    return null;
  }
}
