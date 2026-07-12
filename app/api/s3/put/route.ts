import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { s3, getBucket, isValidKey, getAuthUserId, awsErrorMessage } from "../shared";

/** Upper bound on a single stored document. Heavy `.data.json` objects are the
 *  largest legitimate payload; anything beyond this is rejected before buffering. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  let key: string;
  let body: string;
  try {
    const payload = (await request.json()) as { key?: unknown; body?: unknown };
    if (typeof payload.key !== "string" || typeof payload.body !== "string") {
      return NextResponse.json(
        { error: "Request must include string fields 'key' and 'body'." },
        { status: 400 },
      );
    }
    key = payload.key;
    body = payload.body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isValidKey(key, userId)) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }

  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  try {
    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
    });
    await s3.send(cmd);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[s3/put] error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
