# Predictive tap-seeded Adaptive Crop — implementation plan

Reworks the **Adaptive Crop** so the climber detection region is sized to the
**Climber** (not the frame), recentred on where the Climber is heading, and big
enough that a reaching limb is not clipped out of detection. Removes the
hand-drawn Climber **Manual Crop**: the Climber is selected by a tap, the box is
landmark-derived and shown locked, and the **Wall Crop** ("Route") auto-renders
and stays editable.

Implements ADR 0013. See `CONTEXT.md` for the resolved language.

## Confirmed decisions

| Area | Decision |
|---|---|
| Click behaviour | Tap runs MediaPipe once on the displayed frame, picks the pose at the tap (`selectClimberByPoint`), derives the box from landmarks |
| No-pose fallback | Detect in a zoomed window around the tap; if empty, drop a default climber-proportional box and proceed (never block) |
| Sizing lever | `deriveClimberCrop` sizes the box (seed + per-frame); the per-frame **detection region** grows with it |
| Predictive/motion | Region recentred on `predictCentroid`, motion margin carried by per-step velocity (so it scales with `frameStep`) |
| Floor | Drop the frame-proportional `MIN_CROP_FRAC`; keep only a small absolute degenerate-pose guard |
| Display | The green box on the loading view **is** the region actually detected in |
| Climber UI | Locked box + tap marker, re-tap to change, **no resize handles** |
| Wall/Route crop | Auto-renders from the climber-expanded region on tap, stays **editable** |

## Recommended starting constants (tunable — verify against `climberFrameCoverage` Scan Diagnostics)

| Constant | Old | New (start) | Meaning |
|---|---|---|---|
| `DEFAULT_CROP_PAD` | `0.25` | `0.6` | Base pad as a fraction of bbox half-extent, each side (box ≈ 1.6× bbox) |
| `CROP_PAD_V_BIAS` | — | `1.25` | Extra vertical multiplier on the base pad (reaches are mostly up) |
| `MIN_CROP_FRAC` | `0.18` | **removed** | Replaced by the absolute guard below |
| `ABS_MIN_CROP_FRAC` | — | `0.06` | Degenerate-pose safety floor (frame fraction), not the normal size |
| `MOTION_MARGIN_K` | — | `1.0` | Region margin = `K ×` per-step velocity magnitude (covers ~one more step) |
| `REGION_BASE_SLACK` | `0.15` (slack) | `0.10` | Residual symmetric slack folded into the region builder |
| `TAP_WINDOW` | `0.34 × 0.6` (fixed seed) | `0.45 × 0.75` | Click-time detection window around the tap (portrait, clamped) |

---

## Phase 0 — `deriveClimberCrop` + predictive region (pipeline, pure, fully unit-tested)

**Goal:** the sizing maths, with no UI or processing wiring changed yet.

`pipeline/climberTracker.ts`:

1. **Rework `deriveClimberCrop`** — keep the signature shape, change the body:
   - `halfW = max((bb.w/2) * (1 + DEFAULT_CROP_PAD), ABS_MIN_CROP_FRAC/2)`
   - `halfH = max((bb.h/2) * (1 + DEFAULT_CROP_PAD * CROP_PAD_V_BIAS), ABS_MIN_CROP_FRAC/2)`
   - Centre on the bbox centre; clamp to `[0,1]` (overflow → affected side to `0`/max),
     then convert to pixels. Remove the `minFrac` parameter / `MIN_CROP_FRAC`.
   - This box is the **contained-pose box**: the click seed and the per-frame
     base. No velocity here (the seed has no history).

2. **Add a predictive region builder** — extend `pickAcquisitionRegion` with an
   optional `motion` arg:
   ```ts
   pickAcquisitionRegion(
     lastClimberBox, climberCropPx, frameW, frameH,
     motion?: { predicted: Point; last: Point; frameStep: number },
   ): CropBox | null
   ```
   - No `lastClimberBox` → unchanged (return `climberCropPx` or `null`).
   - With `lastClimberBox` **and** `motion`:
     - `shift = (predicted - last)` in px — the per-step velocity (already
       scales with `frameStep`).
     - Translate the box centre by `shift`.
     - `margin = MOTION_MARGIN_K × |shift| + REGION_BASE_SLACK × boxExtent` added
       each side.
     - Clamp centre+half to the frame (overflow → side pinned to `0`/max).
   - With `lastClimberBox` but no `motion` → today's symmetric `expandCropBox`
     fallback (used by the click seed's first frame).
   - This **replaces the standalone `0.15` slack** so the box isn't double-padded.

**Tests** (`__tests__/pipeline/climberTracker.test.ts`):
- `deriveClimberCrop`: a normal pose yields ≈1.6× bbox; a 2-keypoint degenerate
  pose hits the `ABS_MIN_CROP_FRAC` floor, not a frame-proportional size; a pose
  near an edge clamps the affected side to `0`/max without shrinking the opposite
  side.
- `pickAcquisitionRegion` with motion: an upward-moving climber shifts the region
  up and the bottom margin shrinks toward the frame; a fast move produces a larger
  margin than a slow one; a prediction toward an edge clamps, never inverts.

---

## Phase 1 — Wire the per-frame loop (`hooks/useVideoProcessor.ts`)

**Goal:** the scan uses the predictive region and shows it honestly.

- At the detection-frame region step (~L550), pass motion in:
  ```ts
  const last = history[history.length - 1] ?? null;
  const region = pickAcquisitionRegion(
    lastClimberBox, climberCropPx ?? null, videoWidth, videoHeight,
    last && predicted ? { predicted, last, frameStep } : undefined,
  );
  ```
- `lastClimberBox = deriveClimberCrop(chosen.keypoints, videoWidth, videoHeight)`
  stays (now generous + climber-proportional).
- **Display the real region:** set `currentClimberCrop` from the `region` used to
  detect this frame (fraction), not from `lastClimberBox`, so the loading-view
  green box matches what was actually searched. (Set it right after `region` is
  computed / the frame is painted.)
- Coverage diagnostics: keep sampling from `lastClimberBox` (the contained-pose
  box) so `climberFrameCoverage` still measures climber-in-region tightness.

No change to flip detection, refinement, ORB, or persistence.

---

## Phase 2 — Click-time detection helper + page wiring

**Goal:** a tap produces a landmark-derived locked climber box and an auto wall box.

1. **Pipeline helper** — `pipeline/climberTracker.ts` (or a small new module),
   pure, `detector` passed in:
   ```ts
   deriveTapCrop(
     detector, frame: ImageData, point: Point, frameW, frameH,
   ): { climberCrop: CropFraction } | null
   ```
   - Build the `TAP_WINDOW` region around `point` (clamped).
   - Draw the window to a canvas, `estimateFramesMediaPipe(detector, canvas, ts)`,
     map keypoints to full frame, `selectClimberByPoint(poses, point)`.
   - Pose found → `deriveClimberCrop` → `CropFraction`. None → return `null`
     (caller applies the default-box fallback).

2. **Page callback** — `app/scan/page.tsx` owns `model`/`cv`:
   ```ts
   const handleClimberTapDetect = (frame: ImageData, point: Point) => {
     const r = model ? deriveTapCrop(model, frame, point, w, h) : null;
     const climberCrop = r?.climberCrop ?? defaultBoxAround(point); // soft fallback
     setClimberCrop(climberCrop);
     if (!wallTouchedRef.current) setWallCrop(deriveWallFraction(climberCrop)); // auto Route box
     return r != null;
   };
   ```
   - `deriveWallFraction` = `deriveWallRegion` expressed as a `CropFraction`
     (climber-expanded region), the agreed Wall Crop default.
   - Re-tap clears the boxes and the `wallTouched` flag.

---

## Phase 3 — Step 2 UX (`components/scan/process-flow/StepSetDetection.tsx`)

**Goal:** tap-only Climber, locked box, auto editable Route box, updated copy.

- **`handleClimberTap`**: capture the current frame from `cropVideoRef` to a
  canvas → `ImageData`; call the page callback (await); set the tap marker. Show a
  brief inline spinner while detecting (single MediaPipe call). On fallback, show
  the quiet "pick a clearer frame" hint from ADR 0013 Q2.
- **Climber overlay**: replace the post-tap **resizable** `CropBoxOverlay` with a
  **locked box** (bordered div, no handles — same accent style as the
  `ScanProgress` box) + the existing marker. Keep the bare `tapOnly` surface
  before a tap.
- **Wall overlay**: unchanged editable `CropBoxOverlay` in "Route" mode.
- **Copy**: drop "Size the box to the climber…"; climber-after-tap hint →
  "Climber locked — adjust the Route box or Scan." Update `detectionInstruction`
  / `detectionPurpose` accordingly. Keep the Re-tap button and the
  "Scan anyway" soft-nudge path.

---

## Phase 4 — Docs + checks

- **README**: update the Step 2 / detection description — the Climber is selected
  by a tap (no manual climber box); the Route/Wall box auto-renders and is
  adjustable.
- Per `AGENTS.md`, after each code phase: `npx tsc --noEmit` → `npx eslint .` →
  targeted `npx vitest run __tests__/pipeline/climberTracker.test.ts` →
  `git add .` + `git commit`.

---

## Out of scope / follow-ups

- Tuning the constants above against real Runs (use the dev diagnostics).
- Asymmetric/limb-aware sizing beyond the vertical bias (only if coverage data
  shows clipping persists).
- Panning Capture is unaffected (same crop machinery; per-keyframe wall sampling
  unchanged).
