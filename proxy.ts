import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/utils/firebase/constants";

/**
 * Proxy — checks the Firebase session cookie on every request and redirects
 * unauthenticated users away from protected routes.
 *
 * NOTE: Full session verification (signature + revocation) is performed by
 * Firebase Admin SDK inside Route Handlers (Node.js runtime). Middleware runs
 * in Edge runtime where firebase-admin is unavailable, so this guard is a UX
 * convenience layer only. API routes enforce authentication independently.
 */
export async function proxy(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const isAuthenticated = Boolean(sessionCookie);

  // Protected routes — redirect to login when not authenticated.
  const protectedPaths = ["/scan", "/match", "/view", "/compare", "/profile"];
  const isProtected = protectedPaths.some(
    (p) => request.nextUrl.pathname === p || request.nextUrl.pathname.startsWith(p + "/"),
  );

  if (!isAuthenticated && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // NOTE: We intentionally do NOT redirect authenticated users away from /login.
  // Middleware can only check cookie presence, not validity. A stale __session
  // cookie (expired or revoked server-side) would cause a redirect to /scan
  // where Firebase auth state resolves as null — the user sees a broken page
  // with no nav tabs. The login page handles its own redirect after the
  // Firebase sign-in completes and the server session is verified.

  return NextResponse.next({ request });
}

export const config = {
  matcher: [
    /*
     * Run middleware on all routes except:
     *  - _next/static (static files)
     *  - _next/image  (image optimisation)
     *  - favicon.ico, sitemap.xml, robots.txt
     *  - public assets (svg, png, jpg, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|wasm)$).*)",
  ],
};

