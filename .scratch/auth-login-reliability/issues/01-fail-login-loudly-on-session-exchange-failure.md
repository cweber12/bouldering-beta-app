# Fail login loudly when the session exchange fails

Status: in-progress
Branch: fix/alr-01-fail-login-loudly
Type: AFK

## Parent

- `.scratch/auth-login-reliability/PRD.md`

## What to build

Stop `hooks/useAuth.tsx` from silently swallowing a failed `/api/auth/session`
exchange. Today `createServerSession()` / `deleteServerSession()` `await fetch(...)`
without checking `response.ok`, so a 404/500 resolves as success — `signIn` returns
`null`, the login page navigates to `/scan`, `proxy.ts` finds no cookie, and bounces
back to `/login` in an invisible loop.

- `createServerSession` / `deleteServerSession` check `response.ok` and throw a typed
  error carrying the HTTP status when the response is not ok.
- `signIn` / `signUp` catch that failure, call `firebaseSignOut(auth)` to undo the
  half-authenticated Firebase client state (so client and server agree), and return a
  user-facing error string, e.g. "Could not establish a session. Please try again."
- `app/login/page.tsx` already renders the returned error string — verify it does,
  no new UI expected.

## Acceptance criteria

- [ ] A non-ok `POST /api/auth/session` makes `signIn` / `signUp` return a non-null
      error string (not `null`).
- [ ] On a session-exchange failure the Firebase client is signed back out
      (`firebaseSignOut` called), leaving no half-authenticated client state.
- [ ] A successful (200) exchange still returns `null` and sets the user.
- [ ] The login page shows the error string on failure (verified, existing render
      path).
- [ ] Regression tests in `__tests__/hooks/useAuth.test.tsx` (mock `fetch` + Firebase
      auth) cover: 404 → error + sign-out, 500 → error + sign-out, 200 → success.
- [ ] `npx tsc --noEmit`, `npx eslint .`, and the targeted `npx vitest run` pass.

## Blocked by

None - can start immediately
