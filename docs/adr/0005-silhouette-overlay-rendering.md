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
   `× body scale` keeps the silhouette looking identical across any resolution or
   zoom. The scale is a **single sequence-stable constant** — the median
   per-frame shoulder/torso measure across the whole clip (`computeStableBodyScale`,
   with a shoulder→hip→canvas fallback chain) — so limb widths stay fixed and do
   **not** pulse as the climber moves; only the climber-to-frame ratio sets the
   width. Each rendered layer computes its own constant (callers inject it via
   `SkeletonStyle.bodyScale`), so compare layers never bleed scale into each
   other. The cost is precomputing the scale per sequence and abstract (unitless)
   panel sliders instead of a px readout.

## Consequences

- Confidence dimming (**Estimated Landmark**) applies to the Skeleton pass only;
  the Silhouette is always solid so it never tears into translucent holes.
  **Interpolated Landmarks** are never dimmed.
- The fix lives in the single framework-agnostic `drawSkeleton`, so all three
  render paths (FramePlayer live playback + the two MediaRecorder video
  renderers) inherit it.
- The earlier per-side / per-group line-and-joint style controls were dropped in
  favour of three global rows (Silhouette / Lines / Joints); see CONTEXT.md.

## Update (2026-06-08) — Silhouette is a fat skeleton, not a filled avatar

The original Silhouette construction (per-limb capsules + a filled torso quad + a
head oval + **mitten hand caps** + a single ankle→foot_index foot capsule) was
replaced. Hands read as a featureless ball sitting *on* the wrist, the foot was a
directionless heel-less stub, and the head's ear-span sizing ballooned in profile
and floated above where the neck stopped. The fixes drift toward one model, so we
adopted it wholesale:

**The Silhouette is the skeleton drawn fat.** Every landmark bone is stroked as a
round-capped capsule, all unioned and flattened through the scratch canvas exactly
as before, then composited once at the opacity slider. Only two body parts are
*areas* rather than bones, and they stay filled primitives built from their corner
landmarks:

- **Torso** — the shoulders→hips quad is filled **and** its perimeter stroked at
  the base limb width, so the torso side edges meet the leg capsules at the hips
  (and the top edge meets the arms at the shoulders) with no width step.
- **Head** — a body-scale-sized oval (width ≈ a fixed fraction of shoulder width,
  height ≈ 1.3× that), **not** sized from the ear span (which is huge in profile,
  tiny/occluded head-on). Anchored on the face (eyes→nose) so it follows the
  climber's gaze; tilted to the eye line with a spine-up fallback. The neck capsule
  runs from the shoulder-midpoint to the oval's **bottom edge**, so the head can
  never visually detach — this replaces the old artificial `HEAD_LIFT`.

Width classes are a single base `W` (= `limbThickness` × body scale) for the torso
stroke, arms, legs, and neck — so every shoulder/hip/elbow/knee joint lines up with
zero step — and `0.5·W` for the hand and foot edges (anatomically thinner, and the
half-width strokes still union into a solid hand/foot).

**Hands and feet are drawn over their real landmark edges**, the same `capsule()`
stroke the limbs use, just at `0.5·W`:

- Hand: `wrist→index`, `wrist→pinky`, `wrist→thumb`, `index→pinky` — a fan that
  unions into a hand pointing the real way.
- Foot: `ankle→heel`, `ankle→foot_index`, `heel→foot_index` — a rounded triangle
  with a real heel and real toe.

This is deliberate even though `index`/`pinky`/`thumb`/`heel` are **not** gated by
`filterLandmarks` (only `wrist`/`shoulder`/`hip`/`ankle`/`foot_index` are). Drawing
*derived* hands/feet from the stable proximal joints was considered and rejected:
it loses real orientation, needs special-case geometry and a confidence/plausibility
fallback gate, and is inconsistent with the limb logic. Because the Skeleton pass
already renders these same raw landmarks as thin lines, the fat strokes only thicken
what is already shown — they introduce no landmark the overlay did not already
trust. A missing endpoint simply skips its edge. If a wildly mislocated finger/heel
ever spikes the Silhouette in practice, the cheap guard is to skip an extremity edge
whose length exceeds a plausible multiple of body scale; it is intentionally **not**
added pre-emptively.

The two enduring decisions above (scratch-canvas flatten; sequence-stable body-scale
sizing) are unchanged and carry over verbatim.
