import { NextRequest, NextResponse } from "next/server";
import {
  getAuthUserId,
  followingKey,
  readProfileStorage,
  writeProfileStorage,
} from "../../s3/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFollowing(userId: string): Promise<string[]> {
  const data = await readProfileStorage<{ following?: string[] }>(followingKey(userId));
  return Array.isArray(data?.following) ? data.following : [];
}

async function writeFollowing(userId: string, list: string[]): Promise<void> {
  await writeProfileStorage(followingKey(userId), { following: list });
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
    console.error("[follow/GET]", err);
    return NextResponse.json({ error: "Failed to load following list." }, { status: 502 });
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
    console.error("[follow/POST]", err);
    return NextResponse.json({ error: "Failed to follow user." }, { status: 502 });
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
    console.error("[follow/DELETE]", err);
    return NextResponse.json({ error: "Failed to unfollow user." }, { status: 502 });
  }
}
