import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { s3, S3_PREFIX, getBucket, getAuthUserId, isValidRoutePrefix, awsErrorMessage } from "../../../s3/shared";

// ---------------------------------------------------------------------------
// GET — list another user's climbs (public view)
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const authUserId = await getAuthUserId();
  if (!authUserId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { userId } = await params;

  if (!userId || userId.includes("..") || userId.includes("/") || userId.length > 128) {
    return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
  }

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  const prefix = request.nextUrl.searchParams.get("prefix") ?? `${S3_PREFIX}/${userId}`;
  const delimiter = request.nextUrl.searchParams.get("delimiter") ?? undefined;

  if (!isValidRoutePrefix(prefix, userId)) {
    return NextResponse.json({ error: "Invalid prefix." }, { status: 400 });
  }

  try {
    const objects: Array<{ Key?: string; LastModified?: string; Size?: number }> = [];
    const prefixes: string[] = [];
    let token: string | undefined;

    do {
      const cmd = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: delimiter,
        ContinuationToken: token,
      });
      const res = await s3.send(cmd);

      for (const obj of res.Contents ?? []) {
        objects.push({
          Key: obj.Key,
          LastModified: obj.LastModified?.toISOString(),
          Size: obj.Size,
        });
      }

      for (const cp of res.CommonPrefixes ?? []) {
        if (cp.Prefix) prefixes.push(cp.Prefix);
      }

      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    return NextResponse.json({ objects, prefixes });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[profile/userId/climbs]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
