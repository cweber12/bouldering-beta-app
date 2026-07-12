# Hold detection and the Holds overlay

> **Partially superseded by [ADR 0009](0009-authored-persisted-holds.md)** for
> **Fixed Capture**: options 1 (wall-space detection) and 2 (derived-on-the-fly,
> never persisted) and the "Holds cannot appear in the Detection Preview"
> consequence are reversed there. Holds are now detected in video-frame space at
> scan time, editable, and saved with the Run. Panning Capture and legacy Runs
> still follow this ADR.
>
> **Label placement superseded by [ADR 0010](0010-aligned-leader-hold-numbering.md).** The
> greedy, outward-pushed placement with angled leader lines described below is replaced
> by deterministic per-side placement: a straight horizontal leader from the glyph
> centre to a black-on-white label offset by a constant per-side distance. The Hold
> inference and reveal behaviour here are unchanged.

A third overlay pass, **Holds**, marks where the **Climber**'s hands and feet were
used on the wall, numbered in the order they were first used. A Hold is **inferred
from a Dwell** (a limb held still long enough to be load-bearing) — the app never
detects the physical hold on the **Route Photo**. Detection is a pure
`pipeline/holdDetection.ts` function driven by a `useHolds` hook, derived on the fly
from the same pose frames the **Skeleton** uses; nothing is persisted to S3. See
CONTEXT.md for the language (**Hold**, **Hand Hold**, **Foot Hold**, **Dwell**).

## Considered options (the non-obvious choices)

1. **Dwell is measured in wall/photo space, not video-pixel space.** A gripped hand
   is only motionless _relative to the wall_. In **Fixed Capture** that is also
   motionless in video pixels, but in **Panning Capture** the camera moves, so a
   held hand travels across the frame. Measuring stationarity in raw video-normalised
   coordinates was rejected because it is wrong for Panning Capture (a still hand
   never registers; a panning-matched moving hand briefly does). Detection therefore
   consumes the **already-projected** `SkeletonFrameData.frames` (dense, evenly
   spaced at `targetFps`, in photo pixels via the same gated homography / per-keyframe
   `homographyAtTime` path the Skeleton uses). This couples `useHolds` to the match
   result exactly as `useSkeletonFrames` already is.

2. **Derived on the fly, not persisted.** A pure `detectHolds(frames)` over the
   stored, already-smoothed `attempt.frames` avoids any `RouteAttempt`/S3 schema
   change and back-compat for legacy files, and gives every existing Run Holds for
   free. Numbering is deterministic from first-use timestamps, so it is stable across
   loads. The cost — a few ms recompute per overlay load — is negligible. Persisting
   at scan time was rejected as schema churn with no current payoff; revisit only if
   we add user-editable Holds (overrides would then need somewhere to live).

3. **A confidence guard, because a frozen occluded limb is maximally "stationary."**
   The pose chain deliberately _holds_ an occluded joint in place
   (`HELD_KEYPOINT_SCORE_FACTOR`, `fillPersistentGaps` below the 0.4 dim threshold)
   so the Skeleton stays whole. That frozen point looks perfectly still and would
   register as a false Hold on every occlusion. A Dwell is therefore valid only if
   the contact keypoint is genuinely detected (score ≥ the 0.4 dim threshold) for at
   least half of the Dwell window. A plain mean-confidence threshold was rejected
   because a few good frames drag a mostly-estimated Dwell over the line.

4. **Load-bearing gates, not bare stillness.** A Hand Hold also requires the hand
   point (`mean(index, pinky)`, falling back to the more reliable wrist) to sit
   **above the wrist** — a grip, not a hang or press. A Foot Hold also requires the
   leg to be load-bearing: the knee straightens (stand-up, interior hip–knee–ankle
   angle increases ≥ a threshold) **OR** the leg is braced at a supportive angle
   (knee bent past a straight dangle, or the ankle offset horizontally from the hip
   plumb line). A knee-straighten-only gate was rejected: it misses footholds used
   for support without standing up, which the braced clause recovers. Finger/foot
   landmarks are the least reliable points on a distant climber, hence the proximal
   fallbacks.

5. **Holds merge by kind + location; one combined number sequence.** Dwells of the
   same kind within a merge radius collapse into one Hold numbered by its first use,
   so a re-grip or a two-hand match is one Hold, not several stacked numbers. A hand
   and a foot on the same spot stay two Holds (different colours). Numbering is a
   single chronological hand+foot sequence — colour already distinguishes the kind,
   so the numbers needn't repeat it. A per-dwell "every touch is a number" sequence
   and per-kind numbering were both rejected as harder to read on the wall.

All distances/radii/margins are fractions of the sequence-stable `computeStableBodyScale`
(photo-space shoulder width), as the Skeleton already does, so detection is
resolution-independent. Default sensitivity is Balanced (hand min dwell 0.5 s, foot
min dwell 1.0 s — see ADR 0008, stationary
radius 0.18×scale, merge 0.25×scale, above-wrist 0.05×scale, knee-straighten +20°,
braced knee < 160° or offset ≥ 0.15×scale); the constants live at the top of the
module for easy tuning against real Runs.

## Consequences

- **Holds cannot appear in the Detection Preview.** That preview is raw video-pixel
  space with no homography and exists _before_ the route-photo match; Holds are
  wall-space and post-match, so they are a **Route Overlay**-only feature.
- **Progressive, cumulative reveal.** Each Hold carries its `firstUseTime`; the
  `FramePlayer` draws Holds whose `firstUseTime ≤ t`, so a marker pops in when the
  limb first lands and persists, and the full map is visible by the end. Markers are
  drawn after the Skeleton layers, gated by playback time.
- **Independent toggle.** Holds are a fourth visibility row in the renamed **Overlay**
  panel (was "Skeleton style"), alongside Silhouette / Lines / Joints, so a viewer can
  show pose, Holds, both, or neither. Defaults: Hand Hold cyan, Foot Hold orange (new
  `--color-hand-hold` / `--color-foot-hold` tokens in `globals.css` and canvas values
  in `utils/theme.ts`), each marker a filled disc with a dark ring and a white number
  for legibility over an arbitrary wall photo.
- **Surfaces.** Rendered on every live `FramePlayer` Route Overlay — scan match step,
  saved-Run playback, and both Compare slots. The auto-rendered annotated WebM stays
  pose-only for now: baked-in Holds could not be toggled off in that static artifact.
- Holds whose projected point falls outside the Route Photo bounds are dropped.
