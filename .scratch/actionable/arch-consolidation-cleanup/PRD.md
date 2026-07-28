# Consolidate duplicated implementations behind single owners

Status: ready-for-agent
Disposition: actionable

Spec inputs: repository-wide architecture audit (2026-07-28); layer graph and enforcement
established by `.scratch/actionable/arch-conventions-and-enforcement/PRD.md` and
`docs/adr/0025-mechanically-enforced-layer-boundaries.md`.
Glossary: CONTEXT.md — **Route**, **Run**, **Run Type**, **Route Photo**, **Skeleton**,
**Holds**, **Harness**.

## Problem Statement

Several concepts in this codebase have more than one implementation, and the copies have drifted
apart rather than staying in sync. This is not a tidiness complaint — the divergence is where
behaviour is already inconsistent and where the next edit will introduce a bug.

**One key grammar, six parsers.** The S3 key format
`RouteData/{userId}/{state}/{area}/{route}/run-{ts}-{attempt|send}.json` is parsed by three
near-identical `parseKey` functions in the profile routes (the one in
`app/api/profile/[userId]/routes/route.ts` carries an extra `(?:attempt|run)-(\d+)` timestamp
capture the other two lack), by `parseRunKey` in `app/dev/landing-clip/page.tsx`, and by ten
inline `key.split("/")[1]` expressions scattered across `RouteConsole.tsx`, `app/compare/page.tsx`,
`hooks/useS3Storage.ts`, and `ClimbDetailModal.tsx`. The prefix literal itself is `S3_PREFIX` in
`app/api/s3/shared.ts`, `BETA_FOLDER = "RouteData"` in `app/scan/page.tsx`, and a bare template
literal in `RouteConsole.tsx`. The grammar has no owner, so it cannot be changed safely.

**One security guard, eight copies.** The path-traversal check
`!userId || userId.includes("..") || userId.includes("/") || userId.length > 128` is copy-pasted
into eight route files, alongside eight copies of the `getAuthUserId()` → 401 block and the
`getBucket()` → 500 block. "User-scoped data" and "input length limits" are both items on the
AGENTS.md Security Review Checklist; eight copies is eight places for one of them to be forgotten.
`isValidKey`/`isValidProfileKey` and `isValidPrefix`/`isValidRoutePrefix` are the same two
functions written twice with a different prefix constant.

**Divergent helpers.** Five time formatters produce three different outputs — `m:ss` in four
places, `m:ss.s` in `RunReviewer.tsx`, and `FramePlayer.tsx` lacks the finite guard the others
have. `parseRgb` / `rgbToHsl` / `hueToRgb` / `hslToCss` are byte-identical between
`pipeline/overlay/skeletonOverlay.ts` and `pipeline/overlay/contrastAdapter.ts` **except for the
`parseRgb` fallback colour** (`{0,220,120}` vs `{128,128,128}`). `dist` is defined four times,
`clamp` three times plus `clamp01` twice. `ClimbSummary` is declared in five files.

**Two files carry several modules each.** `pipeline/overlay/skeletonOverlay.ts` (1,029 lines) is a
colour library, a geometry library, and the drawing routines in one file — and its colour half is
the duplicate above. `pipeline/pose/poseInterpolator.ts` (1,004 lines) holds five independent
algorithms, each with its own tuning constants.

**Dead code persists.** `pipeline/legacy/{orbFeatures,orbMatcher}.ts` are imported by nothing but
each other and their own two test files, and they redefine `OrbKeypoint` / `OrbResult` / `OrbMatch`
types that `pipeline/matching/orbDetector.ts` also defines — three names for ORB in one tree.

## Solution

Give every duplicated concept exactly one owner, without changing any observable behaviour.

The governing rule for every consolidation issue in this PRD:

> One canonical implementation whose signature covers **all** observed variants. Each call site
> passes what it already did, so output is provably byte-identical. A characterization test pins
> every variant **before** any call site migrates.

This is deliberately chosen over picking a single "best" behaviour and letting outliers change.
Several of the divergent call sites — `RunReviewer`'s `m:ss.s` timestamps, the skeleton overlay's
fallback colour — sit in files with zero test coverage, so a silent behaviour change there would
not be caught by anything.

Ordering runs consumers-first: the key grammar and the route wrapper (01–02) remove the largest
and most security-relevant duplication; shared types (03) unblock nothing but touch many files;
the helper consolidations (04–06) are independent of each other; the two file splits (07–08)
depend on 04 having taken ownership of the colour helpers; deletion (09) closes out the `knip`
ignore block opened by `arch-conventions-and-enforcement` issue 06.

## User Stories

1. As a maintainer, I want one owner for the S3 key grammar, so that changing the key format is a
   single edit rather than a search across sixteen sites.
2. As a maintainer, I want the key grammar usable on both client and server, so that the ten
   client-side `split("/")[1]` expressions stop reimplementing it by hand.
3. As a maintainer, I want the `RouteData` prefix defined once, so that `S3_PREFIX` and
   `BETA_FOLDER` cannot disagree.
4. As a maintainer, I want legacy `attempt-{ts}.json` keys to keep parsing, so that historical
   runs stay loadable.
5. As a security reviewer, I want the path-traversal guard in one audited place, so that reviewing
   it means reading one function rather than eight.
6. As a security reviewer, I want the 401 and 500 responses uniform across routes, so that an
   endpoint cannot accidentally return a different contract when unauthenticated.
7. As a maintainer, I want `isValidKey`/`isValidProfileKey` unified, so that a fix to one cannot
   leave the other vulnerable.
8. As a maintainer, I want API response types declared once, so that a server-side field addition
   cannot silently diverge from what five client files believe.
9. As a maintainer, I want one colour-conversion module, so that a fix to `rgbToHsl` applies to
   both the skeleton overlay and the contrast adapter.
10. As a maintainer, I want both `parseRgb` fallbacks preserved explicitly, so that consolidation
    does not change what colour a skeleton falls back to.
11. As a maintainer, I want one time formatter covering both precisions, so that all five call
    sites render exactly what they render today.
12. As a maintainer, I want one `ImageData` decoder, so that the pixel-budget cap and the
    `willReadFrequently` hint are applied consistently.
13. As a maintainer, I want hand-rolled seek listeners routed through `utils/videoSeek.ts`, so
    that abort and timeout semantics are uniform.
14. As a maintainer, I want `skeletonOverlay.ts` split along its real seams, so that changing the
    head geometry does not mean scrolling past a colour library.
15. As a maintainer, I want `poseInterpolator.ts` split per algorithm, so that tuning the
    One-Euro smoother is isolated from the bone constraint.
16. As a maintainer, I want dead ORB modules deleted, so that "which ORB module is current?" stops
    being a question.
17. As a reviewer, I want each consolidation to carry a characterization test, so that
    byte-identical output is demonstrated rather than asserted.
18. As a reviewer, I want each call site's migration visible in the diff, so that I can confirm it
    passes what it previously did.

## Implementation Decisions

- **Preserve every variant behind explicit parameters.** `formatPlaybackTime(seconds, {decimals})`,
  `parseRgb(css, fallback)`, key-parse options for the timestamp capture. Widening a signature is
  accepted as the cost of provable behaviour preservation.
- **`storage/routeKey.ts` owns the key grammar**, as isomorphic leaf code consumed by both client
  and server. `storage/` already exists and is already a leaf; no new top-level layer is added.
  Rejected: a server-only `server/` layer (the grammar is needed client-side, so it would have to
  be split back out) and route-tree-only deduplication (leaves the client parsing by hand).
- **`app/api/shared/` holds the route wrapper.** A folder with no `route.ts` is not a route in the
  App Router, so this is safe to colocate.
- Legacy `attempt-{ts}.json` keys must still parse — this is an existing AGENTS.md rule, not a new
  requirement.
- Issues 04 and 07 are coupled: 04 extracts the colour library that 07's split would otherwise
  have to invent. 04 lands first and 07 consumes its module.
- `workers/` is **not** deleted despite being unreferenced — AGENTS.md explicitly says keep.
- Every issue in this PRD lands after `arch-conventions-and-enforcement`, so the boundary rules
  are already active and will reject a consolidation that puts a module in the wrong layer.

## Testing Decisions

- **Characterization tests come first.** For each consolidation, the canonical implementation gets
  a test enumerating every variant observed at the existing call sites — including the ones with
  no current coverage — and that test passes before any call site is migrated. This is what makes
  "no functionality change" checkable rather than asserted.
- Good tests assert the contract of the canonical function, not the internals of the call sites.
- The two file splits (07, 08) are pure moves within a well-covered layer: `pipeline/` has 26 of
  27 modules tested behind 507 assertions. Verification is `tsc --noEmit` plus a full
  `vitest run`; no new tests are written for a split.
- Issue 09's deletion is verified by `knip` reporting clean with an empty ignore block, plus the
  full suite passing after the two legacy test files are removed alongside their sources.
- `app/api/` is currently outside the `vitest` coverage `include` list, so coverage reports will
  not reflect issues 01–02. Judge those two by their characterization tests directly.

Prior art to follow: the existing `app/api/s3/shared.ts` and profile-route tests for API-layer
contract testing, and the deterministic-fixture pattern used throughout the pipeline suites.

## Out of Scope

- **Scan orchestration** — `hooks/useVideoProcessor.ts` belongs to
  `.scratch/actionable/scan-pipeline-isolation-testability/` issues 02–06.
- **UI file splits.** `components/route/RouteConsole.tsx` (1,347 lines) and the near-parallel
  `app/profile/page.tsx` (1,200) and `app/profile/[userId]/page.tsx` (623) — which independently
  implement the same paginated-climbs, pins, and follow-state logic — stay as they are. Both have
  zero test coverage, which makes splitting them a redesign rather than a refactor.
- **`__tests__/` restructuring** beyond relocating tests whose sources this PRD moves.
- **Doc and ADR hygiene** — see the same list in `arch-conventions-and-enforcement`.
- **New test coverage** for the four untested S3 routes, `components/ui/`, or `utils/firebase/`.
  The characterization tests written here cover the extracted functions, not the routes and
  components that call them.
- **`components/route/` vs `components/routes/`** — the singular/plural sibling directories are
  left alone; renaming one is a rename of `RouteConsole.tsx`'s home and buys nothing mechanical.

## Further Notes

- This PRD is P2 and sits in `.scratch/ROADMAP.md` `Next`, behind the three P1 pose PRDs. Its
  issues are mechanical and conflict-tolerant, so they can interleave with pose work if needed.
- Issues 04, 05, and 06 are mutually independent and can be picked in any order among themselves.
- The near-parallel profile pages are the single largest genuine duplication left in the repo
  after this PRD closes. They are out of scope here deliberately; if that changes, they warrant
  their own PRD with a test-coverage slice ahead of the extraction.
