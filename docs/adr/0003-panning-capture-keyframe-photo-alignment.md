# Panning Capture: keyframe-to-photo alignment

## Status

accepted

## Context

The existing scan path extracts ORB features from a single video frame and
matches them to the **Route Photo** once, producing **one** homography that is
reused for every skeleton frame ([skeletonRenderer.ts] applies the same `H` to
all frames). This bakes in a static-camera + planar-wall assumption: it is only
correct when the camera does not move relative to the wall for the whole clip
(a tripod **Fixed Capture**).

Longer routes cannot be held in a single frame — the user must pan the camera up
the wall. Under the single-homography model the overlay drifts off the holds as
the camera moves, because the wall's position in the frame changes frame-to-frame
while the transform does not. ADR 0001 already flagged "camera-motion-compensated
matching" as future work; this is that work, scoped to **deliberate panning**
(not fast handheld shake, which remains out of scope).

## Decision

Add an opt-in **Panning Capture** mode (explicit toggle at scan setup; the
**Fixed Capture** path is unchanged). In this mode:

- **Scan time:** extract and store ORB **Wall Crop** features at **Keyframe**
  intervals (~0.5–1 s), not just the first frame. This is the only new scan cost
  — keyframe ORB, not per-frame ORB.
- **Match time:** ORB the photo once, then compute a homography
  `H_k : keyframe_k → photo` for **each** Keyframe. The photo is the global
  reference: it overlaps every Keyframe, so each Keyframe is anchored
  independently and the result is **drift-free by construction** — no keyframe
  chaining, no bundle adjustment.
- **Render:** for each skeleton frame, find its bracketing Keyframes and
  **decompose-interpolate** their photo-homographies (translation / rotation /
  scale / perspective residual, slerp the rotation) by time-α, then project the
  keypoints. A Keyframe whose `H_k` fails the validity gate (blur / blank wall /
  occlusion) is skipped and interpolated across from its neighbours.

Per-Keyframe match hardening (also applied to the Fixed path):

- **Homography validity gate** — reject degenerate/flipped `H` (positive
  determinant, mapped corners stay convex and ordered, scale within sane bounds).
  Doubles as the co-visibility guard.
- **Absolute Hamming distance cap** (`< ~64`) alongside the Lowe ratio test.
- **Resolution-scaled RANSAC reprojection threshold.**
- **Decode-time pixel cap** on client image decode (decompression-bomb / large
  phone-photo guard).

For Panning Capture the photo is kept at higher resolution (relax
`queryMaxEdgeFor`) because each Keyframe's close-up section maps to a small region
of the whole-route photo and needs the detail to match.

## Considered options

1. **Photo-as-global-reference, keyframe-only ORB** (chosen) — drift-free, no
   per-frame ORB, ~+1 s scan cost, reuses the existing matcher per Keyframe. Maps
   directly onto the use case (the photo sees the whole route).
2. **Per-frame ORB → single anchor keyframe** — rejected: a single anchor cannot
   co-view a full pan (top frames share no features with the anchor), and per-
   frame ORB adds ~+10 s of scan cost.
3. **Keyframe chain / wall mosaic** — register adjacent keyframes to each other,
   align the photo to the mosaic. Works for pans but accumulates drift along the
   chain and wants bundle adjustment, for no gain over photo-as-reference here.
4. **2D translation ("coordinate shift") per frame** — rejected: cannot represent
   the rotation, zoom, and perspective change a real pan produces.
5. **KLT optical-flow tracking between keyframes** — cheaper than ORB but drifts
   and is the most fragile under motion blur; unnecessary once keyframes anchor
   directly to the photo.

## Consequences

- **Storage format change:** the attempt now persists ORB features for N
  Keyframes (~50–100 KB each) instead of one frame — a longer route can be a few
  MB per run (under the 25 MB `/api/s3/put` cap, but real). Tunable via keyframe
  density and feature count. This is the main reason the decision is hard to
  reverse.
- **Smooth-pan assumption:** interpolating `H_k → H_{k+1}` assumes deliberate,
  smooth motion between Keyframes. Violent handheld shake is explicitly not
  supported by this mode (use Fixed Capture, or it degrades).
- **Parallax limit:** the climber is in front of the wall plane, so under camera
  *translation* (not pure rotation) the planar homography mis-projects the body
  slightly. Modest for typical shooting distances; not corrected without depth.
- **Planarity over a long route** is a stronger assumption than over a short
  boulder; routes that curve around an arete will accumulate per-keyframe error.
- Climber masking is deferred — keyframes match to the (climber-free) photo, so
  climber features simply fail to match and fall out via Lowe/RANSAC. The manual
  **Wall Crop** remains the noise control. Per-keyframe people-masking is future
  work if needed.
