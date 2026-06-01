# Roadmap

Deferred engineering work, captured during pipeline audits. Items here are
intentionally *not* yet implemented — each entry records the idea, the trade-off,
and why it was deferred.

---

## Recompute derived data on load instead of persisting it

**Status:** deferred (considered during the save-payload split, 2026-05-31).

**Idea.** `matchesPerFrame` and the dense interpolated `frames` are *derived*
artifacts — they can be regenerated from the sparse pose frames + `orbFeatures`
+ the route photo. Instead of persisting them at all, store only the sparse
inputs and recompute the downstream artifacts when a climb is viewed or compared.

**Upside.** Smallest possible stored object; no duplicated derived state; storage
cost grows only with the genuinely-irreducible inputs.

**Why deferred.** Recomputation couples the *view* to the exact pipeline version
that produced the data. A change to `poseInterpolator` or the ORB matcher would
silently alter how a previously-saved climb renders — a reproducibility footgun
for saved history. We chose instead to persist derived data (split into a
separate `.data.json` side-object — see the save-payload split) so saved climbs
stay immutable regardless of pipeline changes.

**Revisit when.** We introduce explicit pipeline versioning on saved climbs, or
storage cost of the `.data.json` side-objects becomes a measured problem. At that
point recompute-on-load (gated by a stored `pipelineVersion`) becomes safe.
