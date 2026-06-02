# Implementation Plan: Pipeline-Audit Issue Review + Sequenced Delivery

> Status: approved (2026-06-01). Records the review of the PRD + 10 issues in this folder
> and the agreed implementation sequence. Pick this up in a fresh chat to execute.
>
> **Decisions taken with the user:**
> 1. **Issue 07 corrects the auth docs fully** — intentionally overrides the PRD
>    *Out-of-Scope* line (which said only to *record* the inconsistency).
> 2. **Delivery is by workstream** — three sequenced, separately-committed batches (A, B, C).

## Context

`.scratch/pipeline-audit-upload-scan-view-save/` holds a PRD (with a pose addendum) and 10
issues across three workstreams:

- **A — Pipeline hardening** (PRD core, issues 01–05): save atomicity, ORB perf, text
  limits, seek bounding, camera capture gating.
- **B — Pose detection** (PRD addendum, issues 08–10): retire dead retry, climbing-aware
  landmark filtering, quality-tier selector.
- **C — Docs / roadmap** (issues 06–07): track deferred options, correct stale auth docs.

Every issue's factual claims were verified against the live codebase (findings below).

---

## Part 1 — Review findings (contradictions, redundancies, conflicts)

### Verification summary (all issues are factually grounded)

| Issue | Claim | Verdict | Evidence |
|---|---|---|---|
| 01 | Two-object split exists, needs fail-closed completion | ✅ Accurate | `useS3Storage.ts:102` writes metadata **first**, `:103` data second (backwards); load merges via `Object.assign` but `if (dataRes.ok)` never throws on missing heavy data |
| 02 | No query-photo downscale before ORB | ✅ Accurate | `useImageMatcher.ts:169-180` uses full `naturalWidth/Height`; no max-edge cap |
| 03 | No serialization text clamp; profile limit exists | ✅ Accurate | `PROFILE_TEXT_LIMIT=500` (`app/api/s3/shared.ts:149`) guards profile only; route inputs have no `maxLength` |
| 04 | Seek loop unbounded, no abort race | ✅ Accurate | `useVideoProcessor.ts:310-314` awaits `onseeked` with no timeout; abort checked only at loop top (`:306`); recovery loop `:404-433` same pattern |
| 05 | Camera modal always emits capture | ✅ Accurate | `CameraRecorderModal.tsx:77-84` `onstop` always calls `onCapture`; ESC/backdrop close still fire it; no intent flag |
| 08 | `estimateFrameWithRetry` is dead code | ✅ Accurate | Defined `poseDetection.ts:136-211`, **zero call sites**; `scorePoseFrame` still used in `climberTracker.ts`; `meanConfidence` used only inside the dead fn |
| 09 | `filterLandmarks` fixed 2-of-33, no subset/tier | ✅ Accurate | `poseInterpolator.ts:172-183`; called `useVideoProcessor.ts:442` with hardcoded `(0.3, 2, topo.keypointCount)` |
| 10 | lite/full/heavy + frameStep controls, no presets | ✅ Accurate | `StepSetDetection.tsx:149-172`; `maxPoses` exists in `usePoseModel` but is **never wired** from UI (stuck at default 3) |
| 07 | Auth docs say Supabase but impl is Firebase | ✅ Accurate (bigger than stated) | **Zero** Supabase in codebase; real auth is `firebase-admin` `verifySessionCookie` (`app/api/s3/shared.ts:35`, `app/api/auth/session/route.ts`) |
| 06 | Track 3 deferred options | ⚠️ Now incomplete — see below | PRD addendum added 2 more deferrals |

### CONFLICT (resolved): Issue 07 vs PRD Out-of-Scope
- PRD line 87 lists "broad auth/documentation reconciliation … beyond *recording* the
  inconsistency" as out of scope; issue 07 asks to *correct* the docs.
- **Resolution (user):** do issue 07 fully; note the override explicitly.
- Scope is larger than the issue text implies: AGENTS.md has an entire Supabase auth
  section AND a `utils/supabase/*` reference, the security checklist mentions Supabase
  cookies, and CLAUDE.md's auth-flow line is a Firebase/Supabase hybrid. All must change.

### GAP / redundancy: Issue 06 deferred-options list is stale
- Issue 06 acceptance says "all **three** deferred options" (recompute-on-load,
  coarse-to-fine match, rVFC scan loop) — the original (pre-pose) audit set.
- The PRD pose addendum *Out of Scope* added **two more**: handheld/following-camera +
  camera-motion-compensated homography, and appearance/embedding re-identification. It
  also re-points S4 (rVFC) at "issue 06."
- **Recommendation:** expand issue 06 to capture **all five** deferrals, done **last** so
  it reflects the final state after A and B land. (No user decision needed.)

### No true contradictions *between issues*
- 01–05, 08–10 are mutually consistent; all marked "Blocked by: None."
- The only PRD-vs-issue contradiction is 07 (resolved above).

### Sequencing tensions (not blockers, but inform grouping)
- **09 ↔ 10:** 09 wants tier-aware tolerance "once the quality tier exists (issue 10)."
  Doing 09 first ships a non-tier signature that 10 then reworks. → **Do 10's tier-config
  module first, then 09 consumes it.** (Issue 09 anticipates this: "lands with issue 10.")
- **01 ↔ 03:** both touch the serialization boundary (`fsHelpers.ts serializeAttempt*`,
  `useS3Storage.ts`). → group them so the serialization path is edited once.
- **08 unblocked:** the tracker it depends on is already merged (`6137a88 Merge
  feat/climber-identity-tracking`). Doing 08 first de-risks the rest of the pose area.
- **04 recovery path:** the gap-recovery loop changed to identity-based selection since the
  addendum; issue 04 must bound the **current** `:404-433` recovery loop, not the old one.

---

## Part 2 — Implementation plan (by workstream)

> Per AGENTS.md: after each issue run `npx tsc --noEmit`, `npx eslint .`, targeted
> `npx vitest run`, update README when user-visible, then commit. Each workstream is its
> own committed batch.

### Workstream A — Pipeline hardening (issues 01, 03, 02, 04, 05)

**A1 — Issue 01 + 03 together (storage / serialization boundary)**
- 01: In `hooks/useS3Storage.ts` swap write order to **data-first, metadata-last**
  (`putObject(dataKeyFor(key), …)` before `putObject(key, …)`). In the split read path,
  replace the silent `if (dataRes.ok)` with an explicit throw (clear, actionable error)
  when the heavy `.data.json` sibling is missing/invalid.
- 03: Add a `ROUTE_TEXT_LIMIT` (reuse / align with `PROFILE_TEXT_LIMIT=500` in
  `app/api/s3/shared.ts`) and clamp run metadata fields (state/area/route/rating/notes)
  inside `serializeAttemptMetadata` (`utils/fsHelpers.ts`) so **all** save paths inherit it.
  Mirror with `maxLength` on `MetadataBottomSheet.tsx` and `app/upload/page.tsx` inputs.
- Tests: write-order + load-guard (mock S3 boundary); truncation at/above limit.

**A2 — Issue 02 (ORB query-photo normalization)**
- In `hooks/useImageMatcher.ts` (or a helper in `pipeline/orbDetector.ts`), downscale the
  query `ImageData` to a reference-aware longest-edge target with a hard max-edge cap
  before `extractFeatures`; rescale returned keypoints back to native coords (extend the
  existing offset logic at `:117-121`). Keep OpenCV on main thread, `cv` threaded in.
- Tests: keypoint coordinate round-trip; matching still valid post-downscale.

**A3 — Issue 04 (bounded seek)**
- Add a shared seek helper that `Promise.race`s the `seeked` event against a timeout and an
  `AbortSignal`; use it in **both** the primary loop (`useVideoProcessor.ts:310`) and the
  identity-based recovery loop (`:404-433`). Make abort interrupt in-flight seeks.
- Tests: timeout, abort responsiveness, guaranteed loop termination/progress.

**A4 — Issue 05 (camera capture intent gating)**
- In `components/shared/CameraRecorderModal.tsx`, gate `onCapture` on an explicit
  stop-and-save intent ref; teardown (ESC/backdrop/unmount) stops recorder + tracks
  **without** emitting. Apply to both video and photo paths.
- Manual verification (per issue): cancel/ESC/backdrop emit nothing; stop-and-save works.

### Workstream B — Pose detection (issues 08, 10, 09 — in that order)

**B1 — Issue 08 (retire centre-shrink retry)**
- Remove `estimateFrameWithRetry` + `RetryOptions` from `pipeline/poseDetection.ts`. Keep
  `scorePoseFrame` (used in `climberTracker.ts`). Remove `meanConfidence` if it becomes
  unused after the retry fn is deleted; otherwise keep. Delete obsolete retry tests.

**B2 — Issue 10 (Fast/Balanced/Accurate tier selector) — before 09**
- Create one source-of-truth tier module (`utils/poseTiers.ts`) mapping each preset →
  `{ variant, maxPoses, recovery effort, frameStep }`. Replace the model dropdown +
  frameStep slider in `StepSetDetection.tsx` with the preset control; keep advanced knobs.
  Wire `maxPoses` through `app/scan/page.tsx` → `usePoseModel`/`useVideoProcessor` (it is
  currently unwired). Update README detection-controls section.
- Tests: each preset resolves to expected config bundle.

**B3 — Issue 09 (climbing-weighted, tier-aware filtering)**
- Rework `filterLandmarks` (`pipeline/poseInterpolator.ts`) to judge frames on a
  climbing-relevant keypoint subset (hands/feet/hips/shoulders) and accept a tier-tunable
  tolerance param (default preserves current behavior). Consume the tier from B2.
- Tests: occluded-foot frame survives; genuinely degraded frame still dropped.

### Workstream C — Docs / roadmap (issues 07, 06 — last)

**C1 — Issue 07 (correct auth docs to Firebase)** *(overrides PRD Out-of-Scope, per user)*
- Rewrite the Supabase auth sections in `AGENTS.md` and the auth-flow line in `CLAUDE.md`
  to describe the real Firebase session-cookie architecture (`firebase-admin`,
  `verifySessionCookie`, `app/api/auth/session`, `proxy.ts` cookie check, `getAuthUserId`).
  Fix the security-checklist "Supabase cookies" wording and the stale `utils/supabase/*`
  reference. Docs-only — no runtime auth changes.

**C2 — Issue 06 (roadmap deferrals) — do last**
- Add a roadmap entry capturing **all five** deferred options with rationale + a concrete
  reconsideration trigger each: (1) recompute-on-load, (2) coarse-to-fine match refinement,
  (3) rVFC-first scan loop [S4], (4) handheld/following-camera + motion-compensated
  homography, (5) appearance/embedding re-identification. Mark out-of-scope for this pass.
- (Expanding from "three" to "five" closes the issue-06 gap found above.)

---

## Recommended sequence (one line)

`08 → 01+03 → 02 → 04 → 05 → 10 → 09 → 07 → 06`

Rationale: 08 is a safe dead-code removal that de-risks the pose area first; the A-stream
hardening (01+03 grouped) follows; 10 precedes 09 so the tier config exists before the
filter consumes it; docs (07) then the final roadmap (06) land last so 06 reflects the
finished state.

---

## Verification (end-to-end)

- After **every** issue: `npx tsc --noEmit` (zero output), `npx eslint .`, targeted
  `npx vitest run <files>`, then commit. Commit one batch per workstream.
- **A1:** unit-test write-order + missing-heavy-data throw; manual save→reopen of a run.
- **A2:** manual high-res phone-photo match completes without multi-second UI block; ORB
  round-trip test green.
- **A3:** manual long-video scan + mid-scan cancel returns promptly; timeout/abort tests.
- **A4:** manual camera record → cancel/ESC/backdrop emits nothing; stop-and-save advances.
- **B:** tracker/filter/tier tests green; manual scan with each Fast/Balanced/Accurate tier
  shows differing detection behavior; occluded-foot climbing frames survive.
- **C:** doc search for "supabase" returns only intentional historical notes (ideally
  none); roadmap lists all five deferrals.
