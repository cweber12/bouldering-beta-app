# Fix /api/auth/session route-registration 404

Status: ready-for-agent
Type: interactive

## Parent

- `.scratch/auth-login-reliability/PRD.md`

## What to build

Get `POST /api/auth/session` to resolve reliably. The handler only returns
200/400/401, yet the server returns 404 — a route-registration miss (`GET
/api/s3/list`, which can only return 401/400/500/502, 404s identically). Leading
cause: the installed Next is behind the manifest (`package.json` pins
`next@^16.2.10`; running server reports `16.2.7`), compounded by a possibly-stale
Turbopack `.next` cache. Both failing routes import `firebase-admin` (a
`serverExternalPackages` native module).

This issue requires a **live dev server**, so it is interactive (not AFK):

- Resolve version skew: `npm install` so installed Next matches `^16.2.10`; delete
  `.next`; restart `next dev` and confirm the banner version matches the manifest.
- Feedback loop: a throwaway scratchpad script that `POST`s a dummy JSON body to
  `http://localhost:3000/api/auth/session` and asserts the status is **not 404**
  (400 "idToken is required" is the healthy signal), and `GET`s `/api/s3/list` and
  asserts **401**, not 404. Run before and after each change.
- Add temporary `[DEBUG-auth]`-tagged logging at the very top of the route handler to
  prove it is (or is not) invoked; remove before closing the issue.
- Confirm parity with a production build (`next build` + `next start`). If the 404 is
  dev-only, it is a Turbopack/cache/version issue and the reinstall is the fix. If it
  reproduces in a prod build, escalate: investigate the `firebase-admin`
  `serverExternalPackages` interaction (e.g. import boundary, runtime declaration).

## Acceptance criteria

- [ ] Installed Next version matches `package.json` (`^16.2.10`); `.next` rebuilt.
- [ ] `POST /api/auth/session` with a dummy body returns 400 (not 404); a real login
      returns 200 and lands on `/scan` without bouncing to `/login`.
- [ ] `GET /api/s3/list` returns 401 when unauthenticated (not 404).
- [ ] Verified in both `next dev` and `next build && next start`.
- [ ] All `[DEBUG-auth]` instrumentation removed (grep clean).
- [ ] The root cause (version skew / cache / serverExternalPackages) is recorded in
      this issue's Comments before close.

## Blocked by

None - can start immediately (independent of 01, but 01 makes this easier to observe
because login now surfaces the real error).
