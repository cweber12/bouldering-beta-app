import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import type { Readable } from "stream";
import {
  s3,
  getBucket,
  getAuthUser,
  profileKey,
  indexKey,
  awsErrorMessage,
  PROFILE_TEXT_LIMIT,
} from "../s3/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfilePayload {
  displayName?: string;
  location?: string;
  bio?: string;
  /** Base64 data-URL, compressed by the client. */
  profilePicture?: string;
}

// ---------------------------------------------------------------------------
// GET — read the authenticated user's own profile
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  const authUser = await getAuthUser();
  if (!authUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  try {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: profileKey(authUser.id) });
    const res = await s3.send(cmd);

    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as Readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    const profile = JSON.parse(text) as ProfilePayload;
    return NextResponse.json({ ...profile, userId: authUser.id, email: authUser.email });
  } catch (err) {
    // NoSuchKey → fresh profile
    if ((err as Error & { name?: string }).name === "NoSuchKey") {
      return NextResponse.json({ userId: authUser.id, email: authUser.email });
    }
    const msg = awsErrorMessage(err);
    console.error("[profile/GET]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// ---------------------------------------------------------------------------
// PUT — update the authenticated user's profile
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const authUser = await getAuthUser();
  if (!authUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: "S3_BUCKET_NAME is not configured." }, { status: 500 });
  }

  let payload: ProfilePayload;
  try {
    payload = (await request.json()) as ProfilePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Validate text field lengths
  if (
    (payload.displayName && payload.displayName.length > PROFILE_TEXT_LIMIT) ||
    (payload.location && payload.location.length > PROFILE_TEXT_LIMIT) ||
    (payload.bio && payload.bio.length > PROFILE_TEXT_LIMIT)
  ) {
    return NextResponse.json(
      { error: `Text fields must be ${PROFILE_TEXT_LIMIT} characters or fewer.` },
      { status: 400 },
    );
  }

  // Validate profile picture is a data URL (not an arbitrary URL)
  if (payload.profilePicture && !payload.profilePicture.startsWith("data:image/")) {
    return NextResponse.json({ error: "Profile picture must be a data URL." }, { status: 400 });
  }

  try {
    // Save full profile
    const profileBody = JSON.stringify({
      displayName: payload.displayName ?? "",
      location: payload.location ?? "",
      bio: payload.bio ?? "",
      profilePicture: payload.profilePicture ?? "",
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: profileKey(authUser.id),
        Body: profileBody,
        ContentType: "application/json",
      }),
    );

    // Save search-index entry (no picture — keep small)
    const indexBody = JSON.stringify({
      displayName: payload.displayName ?? "",
      email: authUser.email,
      location: payload.location ?? "",
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: indexKey(authUser.id),
        Body: indexBody,
        ContentType: "application/json",
      }),
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[profile/PUT]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
