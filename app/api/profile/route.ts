import { NextRequest, NextResponse } from "next/server";
import {
  getAuthUser,
  profileKey,
  indexKey,
  readProfileStorage,
  writeProfileStorage,
  PROFILE_TEXT_LIMIT,
  awsErrorMessage,
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

  try {
    const profile = await readProfileStorage<ProfilePayload>(profileKey(authUser.id));

    // Keep the profile search index warm for every signed-in user, even if they
    // have never pressed "Save profile". This avoids invisible accounts in
    // /people search when only auth/email exists.
    try {
      await writeProfileStorage(indexKey(authUser.id), {
        displayName: profile?.displayName ?? "",
        email: authUser.email,
        location: profile?.location ?? "",
      });
    } catch (indexErr) {
      // Search index updates should not block profile reads.
      console.error("[profile/GET index]", indexErr);
    }

    if (!profile) {
      return NextResponse.json({ userId: authUser.id, email: authUser.email });
    }
    return NextResponse.json({ ...profile, userId: authUser.id, email: authUser.email });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[profile/GET]", msg);
    // Keep profile UI functional during storage outages.
    return NextResponse.json(
      { userId: authUser.id, email: authUser.email, warning: msg },
      { status: 200 },
    );
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
    await writeProfileStorage(profileKey(authUser.id), {
      displayName: payload.displayName ?? "",
      location: payload.location ?? "",
      bio: payload.bio ?? "",
      profilePicture: payload.profilePicture ?? "",
    });

    // Save search-index entry (no picture — keep small)
    await writeProfileStorage(indexKey(authUser.id), {
      displayName: payload.displayName ?? "",
      email: authUser.email,
      location: payload.location ?? "",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[profile/PUT]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
