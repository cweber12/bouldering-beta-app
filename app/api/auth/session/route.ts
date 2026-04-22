import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/utils/firebase/admin";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_MS } from "@/utils/firebase/constants";

// ---------------------------------------------------------------------------
// POST — exchange a Firebase ID token for an HTTP-only session cookie
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  let idToken: string;
  try {
    const body = (await request.json()) as { idToken?: unknown };
    if (typeof body.idToken !== "string" || !body.idToken) {
      return NextResponse.json({ error: "idToken is required." }, { status: 400 });
    }
    idToken = body.idToken;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const adminAuth = getAdminAuth();
    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_COOKIE_MAX_AGE_MS,
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: SESSION_COOKIE_MAX_AGE_MS / 1000, // seconds
      path: "/",
    });
    return response;
  } catch (err) {
    console.error("[auth/session POST]", err);
    return NextResponse.json({ error: "Failed to create session." }, { status: 401 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — clear the session cookie (sign out)
// ---------------------------------------------------------------------------

export async function DELETE(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });
  return response;
}
