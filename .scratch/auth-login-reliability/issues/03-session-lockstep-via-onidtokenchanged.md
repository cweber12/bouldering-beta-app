# Keep client & server session in lockstep via onIdTokenChanged

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/auth-login-reliability/PRD.md`

## What to build

Eliminate the client/server split-brain. Firebase persists the client session in
IndexedDB, so `onAuthStateChanged` restores `user` on reload even when the server
`__session` cookie has expired or was never minted — the UI looks logged-in while
`proxy.ts` redirects and API routes 401. Keep the server cookie in lockstep with the
Firebase ID token.

In `hooks/useAuth.tsx`:

- Switch the `AuthProvider` bootstrap from `onAuthStateChanged` to
  `onIdTokenChanged`. On every token emission with a signed-in user, re-mint the
  cookie via `createServerSession(await user.getIdToken())`.
- Guard against redundant work: track the last-synced token (or uid+issued-at) and
  skip the POST when it is unchanged, so a re-render or duplicate emission does not
  hammer the endpoint.
- Sign-out continues to `DELETE` the cookie.
- Reuse the loud-failure `createServerSession` from issue 01 (a sync failure here is
  logged, not surfaced as a login error — the user did not just submit the form).
- Confirm the session cookie stays `sameSite: "strict"`, `httpOnly`, `secure` in
  production, `path: "/"`, 14-day max-age in `app/api/auth/session/route.ts`; add a
  one-line comment documenting the strict-vs-lax decision.

## Acceptance criteria

- [ ] `onIdTokenChanged` drives the provider; a token emission re-mints the
      `__session` cookie via `POST /api/auth/session`.
- [ ] A repeated identical token does not trigger a second POST (sync guard works).
- [ ] Sign-out still clears the cookie and the user.
- [ ] With the Firebase client authenticated but the server cookie cleared, a reload
      silently re-mints the cookie and protected routes load without a manual
      re-login.
- [ ] Cookie flags unchanged; strict decision documented in the route.
- [ ] Tests in `__tests__/hooks/useAuth.test.tsx` cover: token emission → POST, and
      unchanged token → no second POST.
- [ ] `npx tsc --noEmit`, `npx eslint .`, and the targeted `npx vitest run` pass.

## Blocked by

- Issue 01 (reuses the loud `createServerSession`).
- Issue 02 (the endpoint must actually resolve for the re-mint to succeed).
