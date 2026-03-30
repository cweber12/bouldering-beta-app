import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import type { Readable } from "stream";
import { s3, getBucket, getAuthUserId, profileKey, awsErrorMessage } from "../../s3/shared";

// ---------------------------------------------------------------------------
// GET — read any user's public profile by userId
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const authUserId = await getAuthUserId();
  if (!authUserId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { userId } = await params;

  // Validate userId is a UUID-like string (no path traversal)
  if (!userId || userId.includes("..") || userId.includes("/") || userId.length > 128) {
    return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
  }

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  try {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: profileKey(userId) });
    const res = await s3.send(cmd);

    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as Readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    const profile = JSON.parse(text) as Record<string, unknown>;
    return NextResponse.json({ ...profile, userId });
  } catch (err) {
    if ((err as Error & { name?: string }).name === "NoSuchKey") {
      return NextResponse.json({ userId });
    }
    const msg = awsErrorMessage(err);
    console.error("[profile/userId/GET]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
