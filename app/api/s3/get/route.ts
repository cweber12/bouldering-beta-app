import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import type { Readable } from "stream";
import { s3, getBucket, isValidKey, getAuthUserId, awsErrorMessage } from "../shared";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const key = request.nextUrl.searchParams.get("key") ?? "";

  if (!isValidKey(key, userId)) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  try {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const res = await s3.send(cmd);

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
    const msg = awsErrorMessage(err);
    console.error("[s3/get] error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
