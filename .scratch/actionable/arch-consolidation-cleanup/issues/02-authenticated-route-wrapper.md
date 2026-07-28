# Collapse the duplicated route guards into one wrapper

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-consolidation-cleanup/PRD.md`
- Security: AGENTS.md Security Review Checklist — "User-scoped data", "Input length limits",
  "Auth gating", "Error sanitisation"

## Blocked by

Issue 01 — the wrapper's key-validation path should call `storage/routeKey.ts` rather than
reimplement it.

## What to build

**This is the security-relevant issue in this PRD.** One guard exists in eight copies, and every
copy is a place it can be forgotten or edited wrong.

The expression

```ts
!userId || userId.includes("..") || userId.includes("/") || userId.length > 128;
```

appears verbatim in `app/api/profile/[userId]/route.ts:21`, `.../climbs/route.ts:27`,
`.../climbs/attempt/route.ts:42`, `.../climbs/detail/route.ts:61`, `.../climbs/page/route.ts:66`,
`.../pins/route.ts:43`, `.../routes/route.ts:95`, and in a variant at
`app/api/profile/follow/route.ts:98`. Alongside it, essentially every profile route repeats the
`getAuthUserId()` → `401 "Authentication required."` block and the `getBucket()` →
`500 "S3_BUCKET_NAME is not configured."` block.

**Build `withAuthenticatedUser()`** in `app/api/shared/`. A folder with no `route.ts` is not a
route in the App Router, so this colocates safely. The wrapper resolves the session, validates the
path parameter, resolves the bucket, and hands the handler a context object with the verified
values — so a handler cannot run at all without them.

Requirements it must preserve exactly:

- `getAuthUserId()` verifies the `__session` cookie server-side via
  `getAdminAuth().verifySessionCookie(cookie, true)`. Do not change that path.
- The 401 and 500 response bodies must stay byte-identical — clients may be matching on them.
- Error sanitisation stays as it is: `awsErrorMessage()` logs details server-side and returns a
  generic message. The wrapper must not start leaking AWS detail into responses.
- `app/api/profile/follow/route.ts:98` uses a _variant_ of the guard. Read it before migrating; if
  it validates something the others do not, the wrapper takes an option rather than the route
  losing a check.

**Unify the validator pairs** in `app/api/s3/shared.ts`. `isValidKey` (line 70) and
`isValidProfileKey` (line 131) are the same function with a different prefix constant, as are
`isValidPrefix` (line 84) and `isValidRoutePrefix` (line 141). Collapse each pair into one
prefix-parameterised function. Keep the existing names as thin wrappers if that keeps the call-site
diff small — the goal is one implementation, not one name.

Every route must still call user-scoping validation before any AWS SDK call. The wrapper makes
that the default rather than something each route remembers.

## Acceptance criteria

- [ ] `withAuthenticatedUser()` exists in `app/api/shared/` and is not routable.
- [ ] A characterization test covers: missing session → 401 with the current body; `userId`
      containing `..`; containing `/`; empty; longer than 128 characters; missing bucket env → 500
      with the current body. It passes before any route is migrated.
- [ ] All eight routes use the wrapper; the inline guard expression appears nowhere in `app/api/`.
- [ ] `app/api/profile/follow/route.ts` retains every check its variant guard performed — any
      difference is expressed as a wrapper option, not dropped.
- [ ] 401 and 500 response bodies are byte-identical to before.
- [ ] `isValidKey`/`isValidProfileKey` share one implementation, as do
      `isValidPrefix`/`isValidRoutePrefix`.
- [ ] Every route still validates user scoping before any AWS SDK call.
- [ ] No AWS or infrastructure error detail reaches a client response.
- [ ] `npx tsc --noEmit`, `npx eslint .`, and `npx vitest run __tests__/api/` pass.
- [ ] `/security-review` run on the branch diff reports no new findings.

## Comments

- Eight copies of a path-traversal guard is the failure mode the AGENTS.md Security Review
  Checklist is meant to prevent, sitting in the repo unnoticed. Worth treating as a security fix
  that happens to also be a refactor, not the reverse.
- The four S3 routes (`put`, `get`, `list`, `delete`) have no tests at all and are the entire
  user-data write path. Writing tests for them is out of scope for this PRD, but if migrating them
  to the wrapper is not obviously safe by inspection, add the coverage rather than guessing.
