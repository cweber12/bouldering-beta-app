import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId, profileKey, readProfileStorage } from "../../s3/shared";

// ---------------------------------------------------------------------------
// GET — read any user's public profile by userId
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

  // Validate userId is a UUID-like string (no path traversal)
  if (!userId || userId.includes("..") || userId.includes("/") || userId.length > 128) {
    return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
  }

  try {
    const profile = await readProfileStorage<Record<string, unknown>>(profileKey(userId));
    if (!profile) {
      return NextResponse.json({ userId });
    }
    return NextResponse.json({ ...profile, userId });
  } catch (err) {
    console.error("[profile/userId/GET]", err);
    return NextResponse.json({ error: "Failed to load profile." }, { status: 502 });
  }
}
