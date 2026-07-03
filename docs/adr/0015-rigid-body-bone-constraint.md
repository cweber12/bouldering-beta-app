# Rigid-body bone constraint (bone-space reconstruction)

## Status

accepted

## Context

The **Scan** pose chain detects the **Climber** on sparse anchor frames, then
densifies and cleans the result: `filter → interpolate → estimate → fill
persistent gaps → smooth` ([poseInterpolator.ts], [useVideoProcessor.ts]). Every
one of those passes operates on a keypoint's **x and y independently, by name**.
None of them knows that `left_elbow` and `left_wrist` are the two ends of a bone
that has a roughly fixed length and a single orientation.

That independence produces two recurring overlay artefacts — limbs that briefly
stretch/snap, and joints that bend the wrong way for a few frames:

- **Chord foreshortening + spline overshoot ("stretch/snap").** Between two
  sparse anchors a rotating joint is carried along the *chord* of its arc,
  independent of its parent, so the bone foreshortens and then snaps back at the
  next anchor. A rigid-arm ground-truth harness measured **~26 %** forearm-length
  distortion introduced by `interpolatePoseFrames` alone, with **no occlusion and
  nothing missing** — purely from independent per-joint interpolation. Catmull-Rom
  adds overshoot at velocity discontinuities (a dyno's sudden catch). Denser
  sampling roughly halves the error but cannot remove it.
- **Stale bone-vector estimation ("bend the wrong way").** When a joint is
  occluded while its limb rotates, `estimateMissingLandmarks` and
  `fillPersistentGaps` place it as `neighbour + (refJoint − refNeighbour)` — a
  bone vector copied verbatim from *one* bracketing frame, with no interpolation
  of the bone's rotation. The harness measured **~34°** of forearm-angle error
  across a rotate-through-occlusion span.

The unifying cause is that the pipeline never enforces the rigid coupling between
a joint and its skeletal parent. A one-line probe that reprojected the wrist to a
fixed length off the elbow drove the stretch to **0 %**, confirming the fix
direction is a rigid-body constraint.

## Decision

Add a final pose-chain stage, **`constrainSkeleton`**, that reconstructs each
limb joint in **bone space** after smoothing:

```
filter → interpolate → estimate → fill persistent gaps → smooth → constrain
```

For each bone `[parent, child]` (walked **proximal → distal** so each child is
rebuilt off an already-corrected parent), the child is recomputed as
`parent + polar(angle, len)`, where `angle` and `len` are interpolated between
the bone's own **real detections** — the sparse anchor frames fed to
interpolation — not the dense estimated frames:

- **Angle** follows the shortest arc between the bracketing detections, so a
  rotating limb sweeps its true arc and an occluded joint's orientation is
  interpolated rather than copied stale.
- **Length** is the linearly-interpolated *projected* bone length between the two
  bracketing detections. Because the references are the true detections, genuine
  foreshortening (a limb pointing toward the camera) is preserved at each anchor
  and merely interpolated between them — this deliberately does **not** pin the
  bone to a fixed/median length, which would over-extend an out-of-plane limb.

The pass is conservative: it only moves joints already present (never inventing a
limb the earlier passes chose to omit), skips a child whose parent is missing
that frame, leaves the torso quad and head untouched (those are anchors / drawn
separately), and preserves each joint's carried-through confidence so the
renderer's Estimated-Landmark dimming is unchanged.

Only the limb + extremity chains are constrained (`BONE_TREE`): upper arms,
forearms, hands off the wrist, thighs, shins, feet off the ankle. The
finger↔finger and heel↔toe web edges are cross-links, not tree bones, and are
omitted.

## Considered options

1. **Bone-space reconstruction as a final constraint pass** (chosen) — additive,
   leaves the existing interpolate/estimate/fill/smooth behaviour (occlusion
   bridging, gap caps, the no-gap guarantee, jitter smoothing) fully intact and
   corrects the geometry on top. Fixes both artefacts. Fully unit-testable
   against a rigid ground truth.
2. **Rewrite `interpolatePoseFrames` to interpolate in bone space directly** —
   rejected for now: a larger rewrite that would churn the well-tested occlusion,
   bridging, and scoring behaviour, for the same visible result the constraint
   pass gives.
3. **Pin bones to a sequence-median length** (the first probe) — rejected: zeroes
   the planar stretch but over-extends legitimately foreshortened limbs, since a
   fixed length cannot represent out-of-plane motion.
4. **Replace Catmull-Rom with a monotone/clamped spline + denser default
   sampling** — rejected as a partial fix: reduces overshoot but not chord
   foreshortening, and does nothing for the wrong-way bend.

## Consequences

- **The pass order is load-bearing.** `constrainSkeleton` must run last, on the
  smoothed frames, using the *pre-interpolation* anchor detections as its
  reference set — that is what lets it honour real projected lengths while
  removing the between-anchor distortion.
- **Adaptive Refinement now compounds.** Extra anchors added for fast motion
  become extra bone references, so the reconstructed arc tracks fast moves more
  tightly — the refinement budget and this pass pull in the same direction.
- **Angle continuity is C0 at anchors.** Bone angle/length are interpolated
  piecewise-linearly between detections, so there can be a slight change in
  angular velocity across an anchor. This was judged visually negligible next to
  the 26 %/34° distortion removed; a C1 (spline-in-bone-space) upgrade is a
  possible follow-up.
- **Downstream consumers see the corrected frames.** Hold authoring
  (`detectHoldsVideoSpace`) and every overlay render use the constrained frames,
  which is the intended improvement.
