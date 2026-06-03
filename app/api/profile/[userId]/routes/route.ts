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
} from "../../../s3/shared";
import { attemptTimestampLabel, parseRunType } from "@/utils/fsHelpers";
import type { RouteSummary } from "@/utils/routeSummary";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedKey {
  key: string;
  state: string;
  area: string;
  route: string;
  filename: string;
  ts: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse state/area/route/filename + embedded timestamp from an S3 key. */
function parseKey(key: string): ParsedKey | null {
  const parts = key.split("/");
  if (parts.length < 6) return null;
  const filename = parts[parts.length - 1];
  const tsMatch = filename.match(/(?:attempt|run)-(\d+)/);
  return {
    key,
    state: parts[2],
    area: parts[3],
    route: parts[4],
    filename,
    ts: tsMatch ? parseInt(tsMatch[1], 10) : 0,
  };
}

/** Fetch the most-recent run JSON for a route to pull thumbnail/rating/coords. */
async function fetchRouteHead(
  bucket: string,
  p: ParsedKey,
): Promise<{ thumbnail?: string; rating?: string; coordinates?: { lat: number; lng: number } }> {
  try {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: p.key });
    const res = await s3.send(cmd);
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as Readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const obj = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>;
    const coords = obj.coordinates as { lat?: number; lng?: number } | undefined;
    return {
      thumbnail: typeof obj.thumbnail === "string" ? obj.thumbnail : undefined,
      rating: typeof obj.rating === "string" ? obj.rating : undefined,
      coordinates:
        coords && typeof coords.lat === "number" && typeof coords.lng === "number"
          ? { lat: coords.lat, lng: coords.lng }
          : undefined,
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// GET — route-grouped summaries
//
// Query params:
//   search — substring over state/area/route
//   state  — substring state filter
//   area   — substring area filter
//   sort   — recent (default) | oldest | route
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

  const filterState = request.nextUrl.searchParams.get("state")?.toLowerCase() ?? "";
  const filterArea = request.nextUrl.searchParams.get("area")?.toLowerCase() ?? "";
  const filterSearch = request.nextUrl.searchParams.get("search")?.toLowerCase() ?? "";
  const sortParam = request.nextUrl.searchParams.get("sort") ?? "recent";

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
        if (obj.Key && !obj.Key.endsWith(".data.json") && (obj.Key.match(/run-\d+.*\.json$/) || obj.Key.match(/attempt-\d+\.json$/))) {
          allKeys.push(obj.Key);
        }
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    // 2. Parse + fold by state/area/route, tracking the most-recent run per route.
    const groups = new Map<string, { head: ParsedKey; count: number }>();
    for (const key of allKeys) {
      const p = parseKey(key);
      if (!p) continue;
      if (filterState && !p.state.toLowerCase().includes(filterState)) continue;
      if (filterArea && !p.area.toLowerCase().includes(filterArea)) continue;
      if (
        filterSearch &&
        !(
          p.state.toLowerCase().includes(filterSearch) ||
          p.area.toLowerCase().includes(filterSearch) ||
          p.route.toLowerCase().includes(filterSearch)
        )
      ) {
        continue;
      }
      const id = `${p.state}/${p.area}/${p.route}`;
      const existing = groups.get(id);
      if (!existing) {
        groups.set(id, { head: p, count: 1 });
      } else {
        existing.count += 1;
        if (p.ts > existing.head.ts) existing.head = p;
      }
    }

    // 3. Fetch the head run for each route (thumbnail/rating/coords) in parallel.
    const entries = Array.from(groups.values());
    const summaries: RouteSummary[] = await Promise.all(
      entries.map(async ({ head, count }) => {
        const meta = await fetchRouteHead(bucket, head);
        return {
          state: head.state,
          area: head.area,
          route: head.route,
          climbCount: count,
          lastClimbedLabel: attemptTimestampLabel(head.filename),
          lastClimbedTs: head.ts,
          lastClimbKey: head.key,
          runType: parseRunType(head.filename),
          thumbnail: meta.thumbnail,
          rating: meta.rating,
          coordinates: meta.coordinates,
          hasGps: !!meta.coordinates,
        };
      }),
    );

    // 4. Sort.
    if (sortParam === "oldest") {
      summaries.sort((a, b) => a.lastClimbedTs - b.lastClimbedTs);
    } else if (sortParam === "route") {
      summaries.sort((a, b) => a.route.localeCompare(b.route) || b.lastClimbedTs - a.lastClimbedTs);
    } else {
      summaries.sort((a, b) => b.lastClimbedTs - a.lastClimbedTs);
    }

    return NextResponse.json({ items: summaries, total: summaries.length });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[profile/userId/routes]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
