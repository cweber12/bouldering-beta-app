import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { s3, getBucket, isValidKey, awsErrorMessage } from "../shared";

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const key = request.nextUrl.searchParams.get("key") ?? "";

  if (!isValidKey(key)) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  try {
    const cmd = new DeleteObjectCommand({ Bucket: bucket, Key: key });
    await s3.send(cmd);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[s3/delete] error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
