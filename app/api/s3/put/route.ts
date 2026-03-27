import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  let key: string;
  let body: string;
  try {
    const payload = await request.json() as { key?: unknown; body?: unknown };
    if (typeof payload.key !== "string" || typeof payload.body !== "string") {
      return NextResponse.json({ error: "Request must include string fields 'key' and 'body'." }, { status: 400 });
    }
    key  = payload.key;
    body = payload.body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isValidKey(key)) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }

  try {
    const client = makeClient();
    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
    });
    await client.send(cmd);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[s3/put] error:", err);
    return NextResponse.json({ error: "Failed to put object." }, { status: 502 });
  }
}
