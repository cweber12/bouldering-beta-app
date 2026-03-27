import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import type { Readable } from "stream";

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

export async function GET(request: NextRequest): Promise<NextResponse> {
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
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const res = await client.send(cmd);

    // Stream body to string.
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as Readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[s3/get] error:", err);
    return NextResponse.json({ error: "Failed to get object." }, { status: 502 });
  }
}
