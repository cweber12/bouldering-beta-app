# Roadmap

Deferred engineering work, captured during pipeline audits. Items here are
intentionally _not_ yet implemented — each entry records the idea, the trade-off,
and why it was deferred.

---

## Recompute derived data on load instead of persisting it

**Status:** deferred (considered during the save-payload split, 2026-05-31).

**Idea.** `matchesPerFrame` and the dense interpolated `frames` are _derived_
artifacts — they can be regenerated from the sparse pose frames + `orbFeatures`

- the route photo. Instead of persisting them at all, store only the sparse
  inputs and recompute the downstream artifacts when a climb is viewed or compared.

**Upside.** Smallest possible stored object; no duplicated derived state; storage
cost grows only with the genuinely-irreducible inputs.

**Why deferred.** Recomputation couples the _view_ to the exact pipeline version
that produced the data. A change to `poseInterpolator` or the ORB matcher would
silently alter how a previously-saved climb renders — a reproducibility footgun
for saved history. We chose instead to persist derived data (split into a
separate `.data.json` side-object — see the save-payload split) so saved climbs
stay immutable regardless of pipeline changes.

**Revisit when.** We introduce explicit pipeline versioning on saved climbs, or
storage cost of the `.data.json` side-objects becomes a measured problem. At that
point recompute-on-load (gated by a stored `pipelineVersion`) becomes safe.

---

## Coarse-to-fine match refinement

**Status:** deferred (considered during the ORB query-photo normalization, 2026-06-01).

**Idea.** Run ORB matching in two passes — a coarse match on a heavily downscaled
query photo to find a rough homography, then a refinement pass on a higher-resolution
crop guided by that initial transform — instead of the single reference-aware
downscale pass that ships in this increment.

**Upside.** Potentially tighter overlay alignment on high-resolution phone photos
where a single downscale step loses fine wall texture.

**Why deferred.** The baseline reference-aware downscale (issue 02) is enough for the
current accuracy target and keeps the matcher a single, easy-to-reason-about pass.
Two-pass refinement adds coordinate-bookkeeping complexity and a second OpenCV
allocation path for an unproven gain.

**Revisit when.** Overlays look visibly misaligned after the reference-aware
downscale lands, i.e. real photos show drift the single pass cannot correct.

---

## `requestVideoFrameCallback`-driven scan loop (S4)

**Status:** deferred (considered during the bounded-seek work, 2026-06-01).

**Idea.** Replace the `seek → await seeked → capture` loop in `useVideoProcessor`
with a `requestVideoFrameCallback`-first architecture that captures frames as the
browser actually paints them, removing the explicit seek-vs-paint race entirely.

**Upside.** Eliminates the class of bug where a frame is captured before the seeked
frame has painted, and can be more efficient than discrete seeking.

**Why deferred.** The bounded-seek hardening (issue 04 — timeout + abort race) makes
the existing loop reliable and cancellable, which covers the observed failure modes.
rVFC is a larger architectural change to the scan loop with its own browser-support
and trimming-semantics questions.

**Revisit when.** The seek-vs-paint race produces bad captures in practice despite
the bounded-seek guard, or per-frame seek latency becomes a measured bottleneck.

---

## Handheld / following-camera support + motion-compensated homography

**Status:** deferred (pose-tracking addendum, 2026-06-01).

**Idea.** Support videos shot with a moving (handheld or climber-following) camera by
estimating per-frame camera motion and compensating the route-photo homography frame
by frame, instead of the current single-frame homography that assumes a static camera.

**Upside.** Lets users scan beta filmed while walking alongside or panning with the
climber, not just from a locked-off tripod.

**Why deferred.** Identity selection is intentionally position-based (torso centroid +
velocity gate) and the homography is computed once from frame 0 — both assume a
reasonably stable camera. Per-frame motion compensation is a substantial new estimation
stage with real accuracy and performance cost.

**Revisit when.** Handheld/following footage becomes a common input and the static-camera
assumption is the dominant source of overlay error.

---

## Appearance / embedding-based re-identification

**Status:** deferred (pose-tracking addendum, 2026-06-01).

**Idea.** Re-identify the tracked climber across occlusions and bystander crossings
using an appearance embedding (visual feature vector) rather than the current
geometric tracker (torso centroid + velocity gate).

**Upside.** More robust identity tracking when the climber is briefly occluded or when
a bystander crosses their path, without relying purely on position continuity.

**Why deferred.** The geometric tracker already satisfies the tracker tests (a bystander
crossing must never switch the track) at far lower memory and complexity cost. An
embedding model adds a second ML runtime and per-frame inference budget.

**Revisit when.** Geometric tracking demonstrably loses the climber in real footage
(e.g. dense gyms with frequent crossings) and the failure cannot be closed with
gate/velocity tuning.
