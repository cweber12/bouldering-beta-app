# Predictive tap-seeded Adaptive Crop replaces the manual Climber crop

## Status

accepted

Refines ADR 0001 (tap-seeded climber-identity tracker) and ADR 0004
(motion-adaptive pose-quality pipeline). Supersedes the part of ADR 0001 that
kept "the manual box remains as an override" for the Climber.

## Context

The **Adaptive Crop** is both what the **User** sees framing the **Climber**
(the green box on the loading view) and the region MediaPipe actually detects in
on the next frame. Two problems traced back to how it was sized and placed
([climberTracker.ts] `deriveClimberCrop` / `pickAcquisitionRegion`,
[useVideoProcessor.ts] seek loop):

- **The crop clipped fast limbs.** It was centred on the *previous* pose and
  padded by a fixed fraction (`DEFAULT_CROP_PAD = 0.25`, slack-expanded `0.15`)
  that did **not** scale with `frameStep`. At the default `frameStep=5` ×
  `100ms` that is ~500ms of travel between detections. A climber reaching up or
  out moved toward one edge, so a reaching hand landed **outside** the crop
  image, MediaPipe returned it at low visibility, the landmark filter dropped it,
  and it became a missing/dim limb — then drove redundant re-detection
  (full-frame re-acquire) and Adaptive Refinement. So "missing limbs" and
  "MediaPipe runs more than necessary" were the same defect.
- **Two ways to frame the Climber.** The Climber was seeded by either a hand-drawn
  **Manual Crop** *or* a tap, and the drawn box could then be resized — duplicate,
  fiddly UX for a region the pipeline already derives better from landmarks.

Per-frame detection is inherent (each call *is* how a frame's landmarks are
obtained); the only avoidable calls are failure-driven, so a crop that stops
clipping is also the efficiency fix.

## Decision

Make the Climber crop fully landmark-derived and remove the hand-drawn Climber
box:

1. **Tap is the only Climber input.** Tapping the Climber in Step 2 runs MediaPipe
   once on a zoomed window around the tap, selects the pose containing the tap,
   and derives the box from those landmarks. The box is shown **locked**
   (non-resizable) for confirmation; there is no Climber resize handle. If
   detection finds nothing, a default climber-proportional box is dropped around
   the tap and the scan proceeds (never hard-blocks) — the full-frame re-acquire
   recovers.
2. **One sizing lever, generous and motion-aware.** `deriveClimberCrop` produces
   the box for both the tap seed and every detection frame. Padding is
   proportional to the **Climber** (not the frame); the frame-proportional
   minimum is replaced by a climber-proportional minimum plus a tiny absolute
   safety floor. A motion budget scales with `frameStep`, and the crop is
   recentred on the velocity-predicted centroid (`predictCentroid`, already
   computed for identity selection) so the margin is spent in the direction of
   travel.
3. **The displayed box is the detection region.** What the User sees is the box
   the next frame is detected in, removing the old gap between the drawn 1.25×
   box and the 1.625× region actually searched.
4. **The Wall Crop auto-renders and stays editable.** Once the Climber is tapped,
   the Wall Crop ("Route") auto-renders from the climber-expanded region
   (`deriveWallRegion`) and remains User-adjustable. It is now the only **Manual
   Crop**.

## Considered options

1. **Predictive, motion-scaled, tap-seeded Adaptive Crop** (chosen) — keeps the
   small-/distant-climber zoom and bystander spatial gating that justify cropping
   at all, while spending margin where the Climber is heading so reaching limbs
   stay in-frame. Fewer gaps → less refinement and fewer re-acquire calls.
2. **Decouple display from detection region** — give the shown box generous
   padding but keep the detection region tight. Rejected: two crop concepts, more
   code, and the reaching limb still falls outside the tight detection region —
   the exact clipping being fixed.
3. **Full-frame detection every frame, drop cropping** — never clips and has no
   miss-retries, but regresses small/distant climbers (the documented "detection
   starts late" failure) and removes spatial bystander gating. A reversal of the
   Adaptive Crop design, not justified by the limb problem alone.
4. **Generous symmetric padding, no predictive recentre** — simpler, but a fast
   directional reach needs a larger total box for the same safety, zooming the
   Climber out more than the predictive option.
5. **Keep the manual Climber crop as an override** (status quo from ADR 0001) —
   rejected: the landmark-derived box is consistently better than a hand-drawn
   one, and the resize affordance added UX cost without improving tracking.

## Consequences

- **A larger crop lowers effective input resolution** for a small/distant
  Climber, which can slightly soften landmark precision. The motion-scaled sizing
  keeps the crop bounded rather than unconditionally large, and the
  `climberFrameCoverage` Scan Diagnostics already track this for tuning.
- **Crop sizing is now coupled to `frameStep`.** A change to sampling density
  changes the motion budget; the two must be reasoned about together.
- **The Climber can no longer be hand-framed.** A pathological frame where
  detection fails at the tap relies on the default-box fallback plus in-scan
  re-acquire rather than a User-drawn box.
- **`predictCentroid` now positions the crop, not just selects identity**, so a
  wrong prediction shifts the crop; the generous base pad absorbs it so it never
  clips worse than a non-predictive crop of the same size.
