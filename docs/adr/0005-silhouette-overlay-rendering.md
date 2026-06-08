# Silhouette overlay rendering model

The pose overlay is drawn as two passes — a translucent **Silhouette** (a unioned
body shape: limb/neck/foot capsules, filled torso quad, filled head oval, mitten
hand caps) beneath a crisp **Skeleton** (thin lines + joint points). Two
non-obvious implementation choices are deliberate and should not be "simplified"
away:

1. **The Silhouette is flattened through an offscreen scratch canvas, not drawn
   shape-by-shape at reduced alpha.** Every piece is drawn at full opacity onto a
   reused module-level scratch canvas, then composited onto the target once at the
   opacity slider's value. Drawing the pieces directly at ~50% alpha was rejected
   because every deliberate overlap (shoulder, hip, neck, ankle) would composite
   darker, producing a body with dark seams instead of one uniform translucent
   shape. A single `Path2D` with nonzero winding was also rejected: limbs are
   round-capped strokes, which cannot be unioned into one fill without
   hand-building capsule polygon geometry.

2. **All sizes are multipliers of a per-frame body scale (shoulder width), not
   absolute pixels.** `drawSkeleton` renders at the Route Photo's native
   resolution, so a fixed-pixel thickness looks like a fat body on a phone photo
   and a thread on a DSLR photo. Expressing limb/joint/line sizes as
   `× shoulder-width` (within-frame fallback chain: shoulder→hip torso height,
   then hip width, then a fraction of the canvas — kept stateless so compare
   layers never bleed scale into each other) keeps the silhouette looking
   identical across any resolution or zoom and lets it pulse correctly as the
   climber moves toward/away from the camera. The cost is a scale reference +
   fallback chain and abstract (unitless) panel sliders instead of a px readout.

## Consequences

- Confidence dimming (**Estimated Landmark**) applies to the Skeleton pass only;
  the Silhouette is always solid so it never tears into translucent holes.
  **Interpolated Landmarks** are never dimmed.
- The fix lives in the single framework-agnostic `drawSkeleton`, so all three
  render paths (FramePlayer live playback + the two MediaRecorder video
  renderers) inherit it.
- The earlier per-side / per-group line-and-joint style controls were dropped in
  favour of three global rows (Silhouette / Lines / Joints); see CONTEXT.md.
