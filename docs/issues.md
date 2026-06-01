# Pipeline Audit — Upload → Scan → View → Save

## Context

Senior-engineer audit of the upload → scan → view → save pipeline. We walk the
pipeline one issue at a time: pause on each finding, explain it, offer three
solutions, and the user picks one. Decided items are recorded here. At the end of
the pass the whole plan is published as a PRD + issues (no implementation this pass,
except Issue #1 which was already implemented and committed before plan mode began).

Pipeline map being audited:
- **Upload/Scan**: `StepPickVideo` → `StepSetDetection` (`useVideoProcessor` seek
  loop → `poseDetection.estimateFrameUnified`) → ORB extraction on frame 0.
- **View**: `StepViewLandmarks` (interpolate + smooth + `useSkeletonFrames`) →
  `StepMatchRoutePhoto` (`useImageMatcher` → homography).
- **Save**: `usePoseVideo` renders the annotated WebM → `useS3Storage.uploadAttempt`
  → `serializeAttemptForJson` → `POST /api/s3/put`.

> Note (docs reconciliation): `AGENTS.md`/`CLAUDE.md` describe a **Supabase** auth
> layer, but the code is **100% Firebase** (`utils/firebase/*`, `useAuth.tsx`,
> `shared.ts` verifies a Firebase session cookie; `utils/supabase/` does not exist).
> Stale-docs cleanup — tracked as a separate doc fix, not a pipeline issue.

---

## Issue #1 — Atomic two-object storage split (was: unbounded self-inflating save payload)  🔶 INCREMENT 1 COMMITTED (`3bf7493`) — needs completion

**Problem.** `uploadAttempt` serialised the entire `RouteAttempt` (dense `frames`,
`matchesPerFrame`, `orbFeatures.descriptors` as a `number[]` ≈4× blowup, base64
thumbnail) into a JSON-in-JSON envelope and POSTed with no body-size guard. List/
card/detail readers (`S3RoutePicker.fetchMeta`, `climbs/detail`, `climbs/page`)
then downloaded the whole multi-MB blob just to render small metadata.

**Decision — Option B (+ base64 from A).** Split each saved run into two S3 objects:
- `{id}-{runType}.json` — small queryable metadata (keeps the existing key, so all
  metadata-only readers got lighter for free).
- `{id}-{runType}.data.json` — heavy `frames` / `matchesPerFrame` / `frameCaptures`
  / `orbFeatures` with **base64** descriptors (~1.33× vs ~4×).

Implemented (increment 1, committed `3bf7493`): split serializers in
`utils/fsHelpers.ts`; split write + merged read + sibling delete in
`hooks/useS3Storage.ts`; 25 MB body guard in `app/api/s3/put`; `.data.json` excluded
from all run-listing filters (route picker, scan/upload pages, `climbs/page` route);
README updated; Option C deferred to `docs/roadmap.md`.

**Remaining to complete this work item — atomic write ordering (folds in what was
briefly tracked as a separate finding).** S3 has no multi-object transaction, so the
two PUTs must be ordered so a partial failure fails *closed* (run invisible), not
*open* (listed but unopenable). Increment 1 writes metadata-first, which fails open:
if the data PUT fails, an orphaned metadata `.json` still appears in listings and
breaks on open (`downloadAttempt` finds no data sibling → `frames`-less attempt).
- **Write data first, metadata last** so the metadata `.json` is the commit marker.
  Listings are gated entirely on the metadata key, and `.data.json` is excluded from
  all listings — so a partial failure leaves only an invisible, GC-able `.data.json`
  orphan and the run never appears.
- **Load-side guard**: if metadata indicates a split run but the data sibling fetch
  fails/returns no `frames`, `downloadAttempt` throws a clear error instead of
  handing the viewer a blank attempt.

Touch point for completion: `hooks/useS3Storage.ts` (`uploadAttempt` PUT order;
`downloadAttempt` guard).

**Option C (deferred → `docs/roadmap.md`).** Recompute derived data on load instead
of persisting it. Rejected for now: couples saved-climb rendering to the exact
pipeline version (reproducibility footgun). Revisit behind explicit pipeline
versioning.

---

## Issue #2 — Match step runs ORB at the route photo's full native resolution  ✅ DECIDED (Option A)

**Problem.** `useImageMatcher` loads the uploaded photo at full
`naturalWidth × naturalHeight` and runs `ORB(3000)` synchronously on the main
thread. For a 12 MP phone photo this blocks the UI for >1 s, and the scale disparity
against a 720p–1080p reference frame degrades match count (which can trigger the
expensive re-anchor pass and a weaker homography). Inputs arrive at varying
resolutions on **both** sides today; will trend toward phone-captured frames later.

**Decision — Option A, refined to a reference-aware query downscale.**
- Before extraction, downscale the query so its longest edge ≈ the reference frame's
  longest edge (from `attempt.videoMeta.width/height`), capped at a hard maximum
  (~1600 px). Run ORB in downscaled space, then scale the returned keypoints back to
  full-photo coordinates so homography stays in native query space (overlay math
  unchanged).
- Self-tunes per attempt; backward-compatible with already-saved references (no scan/
  save-side change); degrades to a near-no-op for the future phone-to-phone case.

**Why not B (coarse-to-fine).** B *contains* A (its coarse step is "match at low
res") and adds a precision-refinement pass. It does not by itself solve the
varying-resolution problem — that is a normalization problem, which is A's job. A
skeleton overlay is forgiving of sub-pixel homography error, so B's refinement is
not justified yet. **Option B → roadmap**, revisit only if overlays look misaligned
after normalization.

**Why not C (Web Worker / OffscreenCanvas).** Fights the documented "OpenCV on main
thread only; never bootstrap WASM in a worker" constraint (`AGENTS.md`); highest
effort/risk and does nothing for match quality.

**Touch points (for implementation pass):** `hooks/useImageMatcher.ts`
(`loadImageAsImageData` → reference-aware downscale + keypoint rescale); new
`downscaleImageData` helper in `utils/cvHelpers.ts` or `utils/imageHelpers.ts`.

---

## Issue #3 — User-supplied run text has no length limit before storage  ✅ DECIDED (Option C)

**Problem.** `state`, `area`, `route`, `rating`, `notes` are stored unbounded —
violates the security checklist ("user strings must be length-limited before
storage"). Inputs in `MetadataBottomSheet` have no `maxLength`; `scan/page.tsx`
passes `rating`/`notes` raw; `/api/s3/put` validates only key + 25 MB body. `notes`
in particular can be ~1 MB/run. `PROFILE_TEXT_LIMIT=500` exists but covers only
profile fields. Data is user-scoped, so this is data-hygiene + checklist compliance
(the 25 MB body cap is already the cross-user/abuse backstop), not a cross-user vuln.

**Decision — Option C: clamp at the serialization boundary + `maxLength` for UX.**
- Add a `ROUTE_TEXT_LIMIT` (≈500, mirroring `PROFILE_TEXT_LIMIT` in
  `app/api/s3/shared.ts`) and enforce it in a small helper at the point a
  `RouteAttempt` becomes a stored object (in `utils/fsHelpers.ts`, applied within/
  before `serializeAttemptMetadata`), so every save path (scan + upload) is covered
  at one chokepoint.
- Add `maxLength` to the rating `<input>`, notes `<textarea>`, and State/Area/Route
  `ComboInput`s in `MetadataBottomSheet` for immediate feedback.
- Keeps the generic `/api/s3/put` endpoint schema-agnostic; 25 MB body cap stays the
  server backstop.

**Why not A (client-only).** Bypassable; duplicated across scan + upload pages.
**Why not B (validate in `/put`).** Couples the generic transport endpoint (also
stores `route-image.json`) to the `RouteAttempt` field schema.

**Touch points:** `utils/fsHelpers.ts` (text-clamp helper + constant);
`components/scan/modals/MetadataBottomSheet.tsx` (`maxLength`).

---

> Note: the two-object **atomicity** finding (data-first commit ordering + load
> guard) was folded into Issue #1 above per decision X — it is a completion
> requirement of the storage split, not a standalone bug. No separate issue.

## Issue #4 — A stuck video seek hangs the entire scan with no recovery  ✅ DECIDED (Option A)

**Problem.** The scan loop awaits one `onseeked` per frame
(`useVideoProcessor.ts` ~L254). If `seeked` never fires — seeking to exactly
`duration` (the last iterations do this via `Math.min(seekTime, duration)`), VFR/odd
keyframes, or background-tab throttling — the promise never settles. The abort check
sits at the top of the iteration, so a stuck await is never re-checked: the scan
hangs in "processing" forever and `reset()` cannot break it (it flips `abortRef` but
the in-flight await never notices); the video element + object URL leak. Secondary:
`seeked` doesn't strictly guarantee the frame is painted before the next `drawImage`
(occasional stale/blank capture).

**Decision — Option A: per-seek timeout + abort race.** `Promise.race` each seek
against (a) a timeout — on which the frame is skipped / the scan fails cleanly with a
message, and (b) an abort signal — on which the loop exits immediately. Guarantees
the loop always makes progress or terminates, and makes `reset()` responsive. Apply
to both seek sites (main loop + gap-recovery loop).

**Why not B (`requestVideoFrameCallback` rewrite).** More correct long-term (also
kills the paint race), but a larger core-loop rewrite needing a no-rVFC fallback →
**roadmap**, reach for it only if the paint race produces bad captures in practice.
**Why not C (abort-only race).** Fixes cancellation but leaves *unattended* hangs
(no human to abort) intact.

**Touch points:** `hooks/useVideoProcessor.ts` (both `await onseeked` sites — main
loop ~L254 and gap-recovery ~L390); a small `seekWithTimeout(video, time, signal)`
helper.

---

## Issue #5 — Cancelling mid-recording can still emit a capture after unmount  ✅ DECIDED (Option A)

**Problem.** `CameraRecorderModal`'s unmount cleanup stops the stream tracks but
never stops the `MediaRecorder`. Stopping tracks while recording makes the recorder
fire `onstop`, which *unconditionally* calls `onCapture(file)`. So Cancel / ESC /
backdrop **while recording** unmounts the modal yet still hands the parent a partial
recording and advances the wizard. `onstop` cannot tell a deliberate stop from
teardown.

**Decision — Option A: distinguish intentional stop from teardown.** Add an
`intentionalStopRef`; the **Stop & save** button sets it before `mr.stop()`. `onstop`
calls `onCapture` only when the flag is set. On unmount, stop the recorder *and*
tracks with the flag false, so teardown (incl. ESC/backdrop) never emits a capture.

**Why not B (cancelled-guard).** A subset of A framed from the cancel side; still
needs separate handling for ESC/backdrop/unmount.
**Why not C (lock modal while recording).** Hostile UX — removes the exit to dodge a
bug A fixes cleanly.

**Touch points:** `components/shared/CameraRecorderModal.tsx` (`intentionalStopRef`,
`onstop` guard, stop recorder in cleanup).

> Side note (out of scope, separate effort): `CameraRecorderModal` is riddled with
> raw-palette theme violations (`bg-black/80`, `text-white`, `bg-red-600`,
> `text-red-400`, …) against the color rules in `AGENTS.md`. Route to `/theme-audit`,
> not this pipeline pass.

---

## Roadmap deferrals (add to `docs/roadmap.md` during implementation)

- **Recompute derived data on load** (Issue #1 Option C) — already in `docs/roadmap.md`.
- **Coarse-to-fine match refinement** (Issue #2 Option B) — revisit only if overlays
  look misaligned after reference-aware downscale.
- **`requestVideoFrameCallback` seek loop** (Issue #4 Option B) — revisit if the
  seek-vs-paint race produces bad captures in practice.

## Separate doc fix (not a pipeline issue)

`AGENTS.md`/`CLAUDE.md` describe a Supabase auth layer; the code is 100% Firebase.
Track as a docs-correction issue.

---

## Deliverable for this pass — publish as PRD + issues

No further implementation in this pass. On approval, publish:

1. A **PRD** summarising the audit and the five decided work items.
2. One **issue per work item**, each carrying its decided option + touch points:
   - #1 Atomic two-object storage split — *complete* the committed increment
     (data-first PUT order + download-side guard in `hooks/useS3Storage.ts`).
   - #2 Reference-aware query downscale before ORB (`hooks/useImageMatcher.ts`,
     new `downscaleImageData` helper).
   - #3 `ROUTE_TEXT_LIMIT` clamp at the serialize boundary + input `maxLength`
     (`utils/fsHelpers.ts`, `MetadataBottomSheet.tsx`).
   - #4 Per-seek timeout + abort race in the scan loop (`hooks/useVideoProcessor.ts`).
   - #5 Intentional-stop guard in the camera modal (`CameraRecorderModal.tsx`).
   - (+ roadmap additions and the docs-correction issue above.)

## Verification (per work item, during implementation passes)

- After every change: `npx tsc --noEmit`, `npx eslint .`, targeted `npx vitest run`.
- #1: unit-test data-first ordering (metadata PUT failure leaves only an invisible
  `.data.json`; download throws on missing data sibling). Manual: save a run, confirm
  it lists + opens; simulate a failed data PUT and confirm the run does not appear.
- #2: unit-test keypoint rescale round-trips to native coords; manual: match a
  high-res phone photo, confirm no multi-second freeze and match count holds.
- #3: unit-test the clamp truncates at `ROUTE_TEXT_LIMIT`; manual: paste >limit notes,
  confirm stored value is capped.
- #4: unit-test `seekWithTimeout` rejects/skips on timeout and exits on abort; manual:
  process a clip and confirm `reset()` interrupts promptly.
- #5: manual: start recording, hit Cancel/ESC/backdrop — confirm no capture is emitted
  and the wizard does not advance; Stop & save still works.
