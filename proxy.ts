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

  // Redirect already-authenticated users away from the login page.
  if (isAuthenticated && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/scan";
    return NextResponse.redirect(url);
  }

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

