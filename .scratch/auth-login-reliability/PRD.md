# Auth & login reliability

Status: ready-for-agent

Spec inputs: dev-server + browser console logs showing `POST /api/auth/session 404`
and a `/login?redirect=/scan` bounce loop. Code under `hooks/useAuth.tsx`,
`app/api/auth/session/route.ts`, `app/login/page.tsx`, `proxy.ts`.
Glossary: CONTEXT.md / AGENTS.md — **Session cookie** (`__session`), **proxy** (Edge
redirect guard), **getAuthUserId** (server-side verification).

## Problem Statement

Logging in is unreliable. It works while a user stays logged in (the 14-day
`__session` cookie is still valid), but when a logged-out user tries to log back in
the login either fails silently or loops back to the login page. The dev logs show
`POST /api/auth/session 404` followed by repeated `GET /login?redirect=%2Fscan 200`.

Three distinct defects compound into the symptom:

1. **Silent failure.** `createServerSession()` / `deleteServerSession()` in
   `hooks/useAuth.tsx` never check `response.ok`. When the session-cookie exchange
   fails (the 404), the failure is swallowed and `signIn` reports success. The login
   page navigates to `/scan`, `proxy.ts` finds no `__session` cookie, and redirects
   back to `/login` — an invisible loop with no error shown to the user.
2. **Route-registration 404.** The `/api/auth/session` handler only ever returns
   200/400/401, yet the server returns 404 — a route-registration miss, not app
   logic (`/api/s3/list`, which can only return 401/400/500/502, 404s the same way).
   The installed Next is behind the manifest (`package.json` pins `next@^16.2.10`;
   the running server reports `16.2.7`), and both failing routes import
   `firebase-admin` (a `serverExternalPackages` native module) — the profile of a
   route that fails to register under a stale/partial Turbopack build.
3. **Client/server split-brain.** Firebase persists the client session in IndexedDB,
   so `onAuthStateChanged` restores `user` on reload even when the server `__session`
   cookie has expired or was never minted. The UI looks logged-in while every
   protected route redirects and every API call 401s, and a re-login attempt hits
   defect 1/2 and stalls.

`/api/dev/corpus 404` (harness-gated) and `/service-worker.js 404` (no such file) in
the same logs are expected behaviour and unrelated to this bug.

## Solution

Fix all three layers so re-login is reliable, fast, and standards-aligned:

1. Make the session exchange fail **loudly**: check `response.ok`, and on failure
   sign the half-authenticated Firebase client back out so client and server agree,
   then surface a clear error to the user instead of a silent redirect loop.
2. Resolve the route-registration 404 against a live dev server: bring the installed
   Next in line with the manifest, clear the Turbopack `.next` cache, and confirm the
   route resolves in both `next dev` and a production build. Escalate the
   `firebase-admin` `serverExternalPackages` interaction only if the 404 survives a
   clean build.
3. Keep the server cookie in lockstep with the Firebase ID token via
   `onIdTokenChanged`: every time Firebase issues or refreshes a token, re-mint the
   `__session` cookie. A returning user with a live Firebase session gets a fresh
   server cookie automatically, eliminating the split-brain.

The session cookie stays `sameSite: "strict"` — the login flow is same-origin, so
strict is safe and the most CSRF-resistant; `lax` is only needed for cross-site
top-level entry into protected routes, which this app does not rely on.

## User Stories

1. As a user, I want a failed login to show a clear error, so that I am not silently
   bounced back to the login page with no explanation.
2. As a user, I want a login whose session exchange fails to not leave me
   half-authenticated, so that the app's logged-in UI never disagrees with what the
   server will actually authorise.
3. As a user, I want logging back in after my session expires to succeed on the first
   try, so that returning to the app does not require repeated attempts.
4. As a user, I want a returning visit where my Firebase session is still valid but
   the server cookie has lapsed to silently re-establish the cookie, so that
   protected routes load without a manual re-login.
5. As a developer, I want the `/api/auth/session` route to resolve reliably in dev
   and prod, so that the session-cookie exchange never 404s.
6. As a developer, I want a fast feedback loop that asserts the auth route is
   reachable, so that a future regression in route registration is caught quickly.
7. As a developer, I want the silent-failure path covered by a regression test at the
   hook seam, so that a swallowed session failure can never ship again.

## Implementation Decisions

- **Loud session exchange.** `createServerSession` / `deleteServerSession` throw a
  typed error carrying the HTTP status when `!response.ok`. `signIn` / `signUp` catch
  it, call `firebaseSignOut` to undo the half-authenticated client state, and return
  a user-facing string ("Could not establish a session. Please try again."). The
  login page already renders returned errors — verified, not re-built.
- **Route 404 is env/build, investigated live.** Run `npm install` to match
  `next@^16.2.10`, delete `.next`, restart `next dev`. A throwaway scratchpad script
  POSTs a dummy body to `/api/auth/session` and asserts a non-404 status (400
  "idToken is required" is the healthy signal); it also GETs `/api/s3/list` and
  asserts 401. Parity is confirmed with `next build && next start`. Temporary
  `[DEBUG-auth]`-tagged logging at the top of the route proves handler invocation and
  is removed before close. Only if the 404 survives a clean prod build do we treat
  the `firebase-admin` `serverExternalPackages` interaction as the cause.
- **Token-driven session sync.** The `AuthProvider` bootstrap switches from
  `onAuthStateChanged` to `onIdTokenChanged`. On every token emission it re-mints the
  cookie via `createServerSession`, guarded so an unchanged token does not re-POST on
  every render. Sign-out still `DELETE`s the cookie. This is the canonical Firebase +
  session-cookie pattern and is what makes re-login durable.
- **Cookie policy.** `sameSite: "strict"`, `httpOnly`, `secure` in production,
  `path: "/"`, 14-day max-age — unchanged; the strict-vs-lax decision is documented,
  not altered.

## Testing Decisions

Tests exercise external behaviour at the hook seam and (for issue 02) a live HTTP
loop — never internal state:

- **`useAuth` hook** (existing jsdom + Testing Library pattern, mock `fetch` +
  Firebase auth): `signIn` returns a non-null error string when `/api/auth/session`
  responds 404/500, and `firebaseSignOut` is called; `signIn` returns `null` on a
  200. This is the correct seam — it replicates the real call chain the bug occurred
  in.
- **Session-sync** (same hook test file): an `onIdTokenChanged` emission triggers a
  `POST /api/auth/session`; a repeated identical token does not re-POST.
- **Route reachability** (issue 02, live-server loop, not a vitest unit): the
  scratchpad script asserts non-404 from `/api/auth/session` and 401 from
  `/api/s3/list`. This is a diagnostic loop, removed once the fix lands; the durable
  guard against re-registration regressions is documented in the issue.

## Out of Scope

- Any migration away from Firebase Auth or the session-cookie model.
- Changes to `proxy.ts` redirect logic beyond what verification requires (it is
  correct — it only reads cookie presence, by design).
- Moving the session cookie to `lax`, or any CSRF-token layer (strict already covers
  the same-origin flow).
- The harness `/api/dev/*` routes and the service-worker 404 (expected behaviour).

## Further Notes

- The 14-day cookie plus `onIdTokenChanged` re-minting means the server session is
  refreshed well within Firebase's hourly ID-token rotation, so the cookie should
  never silently lapse for an active user again.
- If issue 02's 404 proves to be pure version skew, its durable prevention is the
  `package.json`/lockfile staying in sync — no code change beyond the reinstall.
