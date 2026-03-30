import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import type { Readable } from "stream";
import { s3, getBucket, getAuthUserId, followingKey, awsErrorMessage } from "../../s3/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFollowing(bucket: string, userId: string): Promise<string[]> {
  try {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: followingKey(userId) });
    const res = await s3.send(cmd);
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as Readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    const data = JSON.parse(text) as { following?: string[] };
    return Array.isArray(data.following) ? data.following : [];
  } catch (err) {
    if ((err as Error & { name?: string }).name === "NoSuchKey") return [];
    throw err;
  }
}

async function writeFollowing(bucket: string, userId: string, list: string[]): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: followingKey(userId),
      Body: JSON.stringify({ following: list }),
      ContentType: "application/json",
    }),
  );
}

// ---------------------------------------------------------------------------
// GET — list users the authenticated user follows
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  try {
    const following = await readFollowing(bucket, userId);
    return NextResponse.json({ following });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[follow/GET]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
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

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
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
    const following = await readFollowing(bucket, userId);
    if (!following.includes(targetUserId)) {
      following.push(targetUserId);
      await writeFollowing(bucket, userId, following);
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

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
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
    const following = await readFollowing(bucket, userId);
    const updated = following.filter((id) => id !== targetUserId);
    await writeFollowing(bucket, userId, updated);
    return NextResponse.json({ ok: true, following: updated });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[follow/DELETE]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
