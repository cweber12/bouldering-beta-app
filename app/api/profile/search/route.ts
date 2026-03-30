import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import type { Readable } from "stream";
import { s3, PROFILE_PREFIX, getBucket, getAuthUserId, awsErrorMessage } from "../../s3/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface IndexEntry {
  displayName?: string;
  email?: string;
  location?: string;
}

async function readIndexEntry(bucket: string, key: string): Promise<IndexEntry | null> {
  try {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const res = await s3.send(cmd);
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as Readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as IndexEntry;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET — search users by displayName or email (query param: q)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authUserId = await getAuthUserId();
  if (!authUserId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) {
    return NextResponse.json({ error: "Search query must be at least 2 characters." }, { status: 400 });
  }
  if (q.length > 200) {
    return NextResponse.json({ error: "Search query too long." }, { status: 400 });
  }

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  try {
    // List all index entries
    const indexPrefix = `${PROFILE_PREFIX}/_index/`;
    const keys: string[] = [];
    let token: string | undefined;

    do {
      const cmd = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: indexPrefix,
        ContinuationToken: token,
      });
      const res = await s3.send(cmd);
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    // Read index entries in parallel (capped at 50 to limit concurrency)
    const entries = await Promise.all(
      keys.slice(0, 50).map(async (key) => {
        const entry = await readIndexEntry(bucket, key);
        if (!entry) return null;
        // Extract userId from key: ProfileData/_index/{userId}.json
        const userId = key.replace(indexPrefix, "").replace(".json", "");
        return { userId, ...entry };
      }),
    );

    // Filter by search query
    const results = entries
      .filter((e): e is NonNullable<typeof e> => {
        if (!e || e.userId === authUserId) return false;
        const name = (e.displayName ?? "").toLowerCase();
        const email = (e.email ?? "").toLowerCase();
        return name.includes(q) || email.includes(q);
      })
      .slice(0, 20);

    return NextResponse.json({ results });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[profile/search]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
