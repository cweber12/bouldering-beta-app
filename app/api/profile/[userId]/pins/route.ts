import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import type { Readable } from "stream";
import {
  s3,
  S3_PREFIX,
  getBucket,
  getAuthUserId,
  isValidRoutePrefix,
  awsErrorMessage,
} from "../../../s3/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClimbPin {
  key: string;
  lat: number;
  lng: number;
  runType: string;
  route: string;
  area: string;
  state: string;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// GET — return GPS pins for a user's climbs (public; requires auth)
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

  if (!userId || userId.includes("..") || userId.includes("/") || userId.length > 128) {
    return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
  }

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  const prefix = `${S3_PREFIX}/${userId}`;

  if (!isValidRoutePrefix(prefix, userId)) {
    return NextResponse.json({ error: "Invalid prefix." }, { status: 400 });
  }

  try {
    // 1. List all climb JSON files for this user.
    const keys: string[] = [];
    let token: string | undefined;

    do {
      const cmd = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      });
      const res = await s3.send(cmd);

      for (const obj of res.Contents ?? []) {
        if (obj.Key && (obj.Key.match(/run-\d+.*\.json$/) || obj.Key.match(/attempt-\d+\.json$/))) {
          keys.push(obj.Key);
        }
      }

      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    // 2. Fetch each JSON in parallel (capped at 200 most recent).
    const recent = keys.slice(-200);

    async function fetchPin(key: string): Promise<ClimbPin | null> {
      try {
        const cmd = new GetObjectCommand({ Bucket: bucket!, Key: key });
        const res = await s3.send(cmd);
        const chunks: Uint8Array[] = [];
        for await (const chunk of res.Body as Readable) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const text = Buffer.concat(chunks).toString("utf-8");
        const obj = JSON.parse(text) as Record<string, unknown>;
        const coords = obj.coordinates as { lat?: number; lng?: number } | undefined;
        if (!coords || typeof coords.lat !== "number" || typeof coords.lng !== "number") {
          return null;
        }
        return {
          key,
          lat: coords.lat,
          lng: coords.lng,
          runType: typeof obj.runType === "string" ? obj.runType : "attempt",
          route: typeof obj.route === "string" ? obj.route : "",
          area: typeof obj.area === "string" ? obj.area : "",
          state: typeof obj.state === "string" ? obj.state : "",
        };
      } catch {
        return null;
      }
    }

    const results = await Promise.all(recent.map(fetchPin));
    const pins = results.filter((p): p is ClimbPin => p !== null);

    return NextResponse.json({ pins });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[profile/userId/pins]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
