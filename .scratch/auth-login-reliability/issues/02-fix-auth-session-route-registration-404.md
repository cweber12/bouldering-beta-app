# Fix /api/auth/session route-registration 404

Status: in-progress
Type: interactive
Branch: fix/auth-session-route-404

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

- [x] Installed Next version matches `package.json` (`^16.2.10`); `.next` rebuilt.
- [x] `POST /api/auth/session` with a dummy body returns 400 (not 404). (The
      real-login-200 half was not exercised in this automated run — no headless
      Firebase test account; the 400/401 healthy signals prove both handlers execute,
      which is the defect that was failing. See Comments.)
- [x] `GET /api/s3/list` returns 401 when unauthenticated (not 404).
- [x] Verified in both `next dev` and `next build && next start`.
- [x] All `[DEBUG-auth]` instrumentation removed (grep clean).
- [x] The root cause (version skew / cache / serverExternalPackages) is recorded in
      this issue's Comments before close.

## Blocked by

None - can start immediately (independent of 01, but 01 makes this easier to observe
because login now surfaces the real error).

## Comments

- 2026-07-17 (tracker audit): still valid — re-verified the version skew:
  installed Next is 16.2.7 while `package.json` pins `^16.2.10`. The
  `npm install` + `.next` rebuild step has not been run yet.
- 2026-07-17 (fix): **Root cause = stale `node_modules` + stale `.next` Turbopack
  cache, not `serverExternalPackages`.** The lockfile already resolved
  `next@16.2.10`; only the installed `node_modules` was behind at 16.2.7. `npm install`
  synced `node_modules` to the lockfile (16.2.7 → 16.2.10) and `rm -rf .next` cleared
  the Turbopack cache. No source or lockfile change was required — the fix is purely
  operational.
  - Verified with a throwaway probe (`scratchpad/probe-auth-route.mjs`): `POST
    /api/auth/session` → **400** ("idToken is required.") and `GET /api/s3/list` →
    **401** ("Authentication required.") — both non-404, in `next dev` **and** a clean
    `next build && next start` (Next 16.2.10 banner confirmed in both).
  - Temporary `[DEBUG-auth]` log at the top of the POST handler fired once per request,
    proving the handler is invoked (not a route-registration miss); removed after
    verification (source grep clean).
  - Since the 404 did **not** survive a clean prod build, the `firebase-admin`
    `serverExternalPackages` interaction is ruled out — no escalation needed.
  - **Durable prevention:** keep `node_modules` in sync with the lockfile (a plain
    `npm install`/`npm ci` after a lockfile bump) and clear `.next` after a Next upgrade.
    The lockfile/manifest are already aligned, so no further code change guards this.
