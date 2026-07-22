import { NextRequest, NextResponse } from "next/server";
import {
  getAuthUserId,
  followingKey,
  readProfileStorage,
  writeProfileStorage,
  awsErrorMessage,
  S3_PREFIX,
} from "../../s3/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFollowing(userId: string): Promise<string[]> {
  const primaryKey = followingKey(userId);
  const fallbackKey = `${S3_PREFIX}/${userId}/_social/following.json`;

  try {
    const data = await readProfileStorage<{ following?: string[] }>(primaryKey);
    return Array.isArray(data?.following) ? data.following : [];
  } catch (err) {
    console.error("[follow/readFollowing]", awsErrorMessage(err));
    // Fallback: if ProfileData is unavailable, read from the user-scoped
    // RouteData namespace (same bucket/credentials used by climbs).
    try {
      const data = await readProfileStorage<{ following?: string[] }>(fallbackKey);
      return Array.isArray(data?.following) ? data.following : [];
    } catch (fallbackErr) {
      console.error("[follow/readFollowing:fallback]", awsErrorMessage(fallbackErr));
      // Corrupted or missing payload should not block follow/unfollow; a
      // successful write will normalize the file shape.
      return [];
    }
  }
}

async function writeFollowing(userId: string, list: string[]): Promise<void> {
  const primaryKey = followingKey(userId);
  const fallbackKey = `${S3_PREFIX}/${userId}/_social/following.json`;

  try {
    await writeProfileStorage(primaryKey, { following: list });
  } catch (err) {
    console.error("[follow/writeFollowing]", awsErrorMessage(err));
    // Fallback to RouteData scope so follow/unfollow still persists when
    // ProfileData permissions are unavailable.
    await writeProfileStorage(fallbackKey, { following: list });
  }
}

// ---------------------------------------------------------------------------
// GET — list users the authenticated user follows
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const following = await readFollowing(userId);
    return NextResponse.json({ following });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[follow/GET]", msg);
    // Keep profile and people pages usable even when storage is down.
    return NextResponse.json({ following: [], warning: msg }, { status: 200 });
  }
}

// ---------------------------------------------------------------------------
// POST — follow a user (body: { targetUserId })
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let targetUserId: string;
  try {
    const body = (await request.json()) as { targetUserId?: unknown };
    if (typeof body.targetUserId !== "string" || !body.targetUserId) {
      return NextResponse.json({ error: "targetUserId is required." }, { status: 400 });
    }
    targetUserId = body.targetUserId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (targetUserId === userId) {
    return NextResponse.json({ error: "Cannot follow yourself." }, { status: 400 });
  }

  if (targetUserId.includes("..") || targetUserId.includes("/") || targetUserId.length > 128) {
    return NextResponse.json({ error: "Invalid target user ID." }, { status: 400 });
  }

  try {
    const following = await readFollowing(userId);
    if (!following.includes(targetUserId)) {
      following.push(targetUserId);
      await writeFollowing(userId, following);
    }
    return NextResponse.json({ ok: true, following });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[follow/POST]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — unfollow a user (body: { targetUserId })
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let targetUserId: string;
  try {
    const body = (await request.json()) as { targetUserId?: unknown };
    if (typeof body.targetUserId !== "string" || !body.targetUserId) {
      return NextResponse.json({ error: "targetUserId is required." }, { status: 400 });
    }
    targetUserId = body.targetUserId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const following = await readFollowing(userId);
    const updated = following.filter((id) => id !== targetUserId);
    await writeFollowing(userId, updated);
    return NextResponse.json({ ok: true, following: updated });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[follow/DELETE]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
