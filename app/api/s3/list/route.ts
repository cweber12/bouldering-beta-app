import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";

const S3_PREFIX = process.env.S3_KEY_PREFIX ?? "RouteData";

function makeClient() {
  return new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
}

/** Reject any prefix that tries to escape the allowed S3_PREFIX tree. */
function isValidPrefix(prefix: string): boolean {
  return (
    !prefix.includes("..") &&
    (prefix === "" || prefix.startsWith(S3_PREFIX + "/") || prefix === S3_PREFIX)
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const raw = request.nextUrl.searchParams.get("prefix") ?? S3_PREFIX;

  if (!isValidPrefix(raw)) {
    return NextResponse.json({ error: "Invalid prefix." }, { status: 400 });
  }

  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  try {
    const client = makeClient();
    const cmd = new ListObjectsV2Command({ Bucket: bucket, Prefix: raw });
    const res = await client.send(cmd);
    return NextResponse.json({ objects: res.Contents ?? [] });
  } catch (err) {
    console.error("[s3/list] error:", err);
    return NextResponse.json({ error: "Failed to list objects." }, { status: 502 });
  }
}
