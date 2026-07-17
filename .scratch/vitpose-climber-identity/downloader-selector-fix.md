# Downloader task: fix Climber selection in the ViTPose job (Phase A)

> **Archived 2026-07-17.** Every item below is implemented and unit-tested in
> beta-scan-analysis `vitpose_job.py` (`6445d7a`, seed diagnostics `c7afff9`);
> issue 02 is closed. The stitching behaviour described here has since been
> superseded by appearance-anchored stitching with backtrack recovery
> (downloader issue #19) — see the PRD's Problem Statement item 5 and status
> notes. Kept for contract history (`climber_point.t`).

Instructions for an agent working in the **downloader repository**
(`beta-scan-analysis`, module `vitpose_job.py`). beta-scanner's harness observes
wrong-person Ground Truth seeds on videos with bystanders — both wrong-from-frame-0
and mid-clip hijacks. The selection logic needs four targeted changes. The
beta-scanner side (tap timestamp plumbing) is issue 01 in
`.scratch/vitpose-climber-identity/`.

## Contract change

`climber_point` may now carry the tap's video time:

```jsonc
"climber_point": { "x": 0.5, "y": 0.4, "t": 2.33 } | { "x": 0.5, "y": 0.4 } | null
```

`t` is optional, finite, and `>= 0` (seconds in source-video time) for the
frame the user tapped on. Legacy requests (and setups saved before the change)
omit it.

## Changes (all in `vitpose_job.py`, unit-test via the existing stub seams)

1. **Anchor the seed to the tap's frame.** In `_seed_climber`'s tap branch, when
   `t` is present consider only history frames whose timestamp is within a small
   window of `t` (suggest ±0.75 s, wide enough to survive tracker stride and a
   detection miss on the exact frame). Prefer a box containing the tap; else the
   nearest box center *within the window*. Never fall back to a global search
   when `t` is present. Without `t`, replace the current global nearest-center
   pick with the **earliest** frame whose box contains the tap (users tap near
   the start); keep global-nearest only as the final fallback.

2. **Gate the seed with the crop.** When `climber_crop` is present, the chosen
   seed box's center must lie inside the crop expanded by ~10% each side;
   otherwise reject that candidate and take the next best in the window. The
   crop gates the **seed only** — the stitched trajectory may leave the crop
   (the climber climbs out of it).

3. **Cap the association slack + size continuity.** In `build_climber_track`,
   change the threshold to `min(_ASSOC_BASE + _ASSOC_PER_FRAME * gap, _ASSOC_MAX)`
   with `_ASSOC_MAX ≈ 0.18`. On re-acquisition after a gap, also require the new
   box's area to be within a ratio band of the last associated box (suggest
   [1/3, 3×]) — a belayer standing at the base is not the climber who vanished
   near the top.

4. **Remove the silent un-crop fallback.** In `_largest_track`, delete the
   "crop filtered everyone out → largest track anywhere" fallback. An empty
   result means an empty trajectory → every frame is written `keypoints: []` →
   beta-scanner disables authoring and prompts a re-tap. Honest failure beats a
   confidently wrong seed.

## Unchanged

- Timestamp echo, artifact shape (`version: 1`), status sidecar, path guards.
- The stitched-trajectory approach itself (ByteTrack ids still fragment; we
  still stitch — just with bounded slack).

## Acceptance

- Existing tests still pass; new tests cover: window anchoring with `t`,
  containing-beats-nearest, crop gate rejection, slack cap across a long gap,
  size-continuity rejection, empty trajectory on crop filter-out, legacy no-`t`
  earliest-containing seed.
- Manual: on a known bad clip with a spotter, the posed track is the climber
  for the full ascent.
