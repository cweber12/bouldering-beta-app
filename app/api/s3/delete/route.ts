import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";

const S3_PREFIX = process.env.S3_KEY_PREFIX ?? "RouteData";

function makeClient() {
  return new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
}

function isValidKey(key: string): boolean {
  return (
    key.endsWith(".json") &&
    !key.includes("..") &&
    key.startsWith(S3_PREFIX + "/")
  );
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const key = request.nextUrl.searchParams.get("key") ?? "";

  if (!isValidKey(key)) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }

  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  try {
    const client = makeClient();
    const cmd = new DeleteObjectCommand({ Bucket: bucket, Key: key });
    await client.send(cmd);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[s3/delete] error:", err);
    return NextResponse.json({ error: "Failed to delete object." }, { status: 502 });
  }
}
