# Tap-seeded climber-identity tracker

## Status

accepted

## Context

MediaPipe Pose Landmarker has no notion of _who_ the climber is; it returns the
most-prominent pose(s) per frame. With `numPoses: 1` the pipeline followed
whoever the model rated most prominent, so a bystander entering the user's crop
could steal the track for the rest of the clip. The manual crop box was also the
only way to tell the app where the climber was — accurate but a UX pain point.

## Decision

Detect multiple poses per frame and maintain an explicit **Climber Identity**:
seed it from a single tap on the climber in the first frame (falling back to the
strongest pose), then on each frame select the detected pose whose torso centroid
is nearest the velocity-predicted position, rejecting any candidate outside a
distance gate. Derive the per-frame detection crop adaptively from the climber's
landmarks instead of a fixed user-sized box; the manual box remains as an
override. Gap recovery selects by the same identity rule rather than full-frame
single-pose detection.

## Considered options

1. **Tap-seeded identity tracker + adaptive crop** (chosen) — fixes both the
   bystander and the manual-crop problems, preserves the accuracy benefit of
   cropping, reuses existing crop machinery, and is memory-bounded.
2. **Full-frame multi-pose every frame, no crop** — robust identity but discards
   the crop accuracy benefit and is the slowest.
3. **Velocity-gated single-pose** — cheapest, but cannot distinguish climber from
   bystander once the climber is lost.
4. **Appearance/embedding re-ID** — most robust through crossings, but adds
   compute and memory, conflicting with the project's memory constraint.
5. **OpenCV optical-flow region tracker** — good for handheld cameras, but drifts
   over long clips and struggles with fast climbing motion.

## Consequences

- Requires `numPoses > 1` (default 3), a small per-frame cost paid for
  disambiguation; multi-pose widening only fires on low confidence / loss.
- The blind centre-shrink retry (`estimateFrameWithRetry`) is no longer used in
  the main loop — superseded by the "widen + re-select by identity" path.
- Identity selection is position-based, so it assumes a reasonably stable camera;
  handheld/following support and camera-motion-compensated matching are future
  work (tracked separately).
