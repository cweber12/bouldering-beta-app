import { NextRequest, NextResponse } from "next/server";
import {
  S3_PREFIX,
  getAuthUserId,
  isValidRoutePrefix,
  readProfileStorage,
  awsErrorMessage,
} from "../../../../s3/shared";

// ---------------------------------------------------------------------------
// GET — read one of another user's RouteData objects by full key, merging the
// heavy-data sibling when present.
//
// This is the cross-user counterpart of the self-scoped `/api/s3/get`. It lets
// any authenticated user read another user's saved Run (pose frames, ORB
// features, matches) so their skeleton can be overlaid in the compare console,
// and their Route Photo (route-image.json) so it can anchor the homography.
//
// Reads are prefix-gated to `RouteData/{userId}/…` exactly like the other
// `/api/profile/[userId]/climbs/*` routes — the same openness that already
// serves climb metadata/thumbnails to any authenticated user.
//
// Query params:
//   key — the full S3 key for the RouteData object (metadata `.json` or photo)
// ---------------------------------------------------------------------------

/** Derive the heavy-data sibling key for a metadata key. */
function dataKeyFor(key: string): string {
  return key.replace(/\.json$/, ".data.json");
}

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

  // Validate the key is a `.json` object scoped to the target user's RouteData.
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

  try {
    // The metadata object is the record's existence marker. A `.data.json`
    // sibling (present for split-format Runs) carries the heavy pose data; a
    // Route Photo or a legacy combined Run has no sibling and is returned as-is.
    const meta = await readProfileStorage<Record<string, unknown>>(key);
    if (meta == null) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const data = await readProfileStorage<Record<string, unknown>>(dataKeyFor(key));
    const merged = data ? { ...meta, ...data } : meta;

    return NextResponse.json(merged);
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[climbs/attempt]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
