# Limb-aware reach-disk expansion for the Adaptive Crop

## Status

accepted

Completes the "asymmetric / limb-aware sizing" follow-up deferred by ADR 0013
(predictive tap-seeded Adaptive Crop).

## Context

The Adaptive Crop is sized by `deriveClimberCrop` from `poseBBox(keypoints)` — but
that bbox only contains keypoints that survived the `score >= 0.3` visibility
filter in `mediapipePoseDetection.ts`. A limb whose endpoint fell below the filter
(or was clipped outside the previous crop entirely) is simply **not in the bbox**,
so the symmetric pad — even at `DEFAULT_CROP_PAD = 0.6` with the vertical bias — is
measured against a body extent that excludes the missing limb.

Because the crop is also the **next frame's detection region**
(`useVideoProcessor` seek loop, ADR 0013), this creates a feedback loop: a missing
limb is not in the bbox → the region is tight on that side → the limb stays outside
the region → MediaPipe never sees it → it stays missing. Limbs that were briefly
undetected never re-enter detection and are clipped for the rest of the climb.

ADR 0013 named limb-aware sizing as out of scope until coverage data showed the
symmetric pad was insufficient. It is — fully-extended reaches off a tucked or
mis-detected limb are exactly the clip case the vertical bias does not cover when
the limb is *absent* rather than merely close to an edge.

## Decision

When a limb's endpoint keypoint is missing, grow the crop on that side by a
**reach disk** — the region the endpoint could occupy if the limb were extended.
Implemented entirely inside the pure `deriveClimberCrop` (`climberTracker.ts`); no
caller signature change.

1. **Missing = endpoint absent, anchor present.** A limb is actionable when its
   endpoint (arm → `wrist`, leg → `ankle`) is not in the pose but its anchor
   (shoulder / hip) is. The endpoint reaches furthest, so it defines the clip;
   anchor-gating skips poses too degraded to place a disk.
   (`findMissingLimbs`, exported so the per-frame loop can count expansion frames.)
2. **Reach disk, not a direction guess.** The endpoint can be anywhere within the
   limb's length of its anchor, so the box grows to contain a disk of that radius
   centred on the anchor — direction-agnostic, never guessing wrong. The existing
   vertical bias still applies on top, matching the climbing reality that the most
   common missing-arm case is an overhead reach.
3. **Radius from the mirror limb, torso fallback.** The radius is the
   contralateral limb's **segment sum** (upper + lower) when that limb is detected
   (so a *bent* mirror limb still yields full reach); otherwise
   torso (shoulder↔hip) length × an anthropometric ratio (`ARM_REACH_TORSO_RATIO`
   1.4, `LEG_REACH_TORSO_RATIO` 1.6).
4. **Per-edge max composition.** Each edge takes the furthest-out of the normal
   padded box and the disk's bounding box, plus a small `REACH_DISK_MARGIN` (8%)
   so a re-entering endpoint lands inside the region rather than on its edge. The
   box only grows where a limb could reach; it never tightens.
5. **Two guards against ballooning.** Anchor-gating (1) and a climber-relative cap:
   the disks may not push an edge past `REACH_MAX_EXPANSION` (2.0) × the normal
   half-extent from the box centre. The existing `[0,1]` frame clamp is the final
   outer bound.
6. **Stateless / self-healing.** `deriveClimberCrop` stays pure. Once a limb
   re-enters and is detected, it is in the bbox, its disk stops firing, and the box
   tightens back; the normal pad + motion margin keep a just-returned endpoint
   inside without per-limb hysteresis state.

A dev-only `limbExpandedFrames` count is added to Scan Diagnostics so the
constants above can be tuned against real Runs.

## Considered options

1. **Reach disk per missing limb** (chosen) — physically correct and
   direction-agnostic; grows only the missing side, capped and self-healing.
2. **Type-directional heuristic** (missing arm → up + named side) — rejected:
   under-covers cross-body and sideways reaches, which do clip.
3. **Larger symmetric pad when any limb is missing** — rejected: over-zooms
   uniformly, shrinking the climber in the detection input (the ADR 0013 failure)
   without targeting the side that actually clips.
4. **Fix only the seed crop** — rejected: the clipping is the per-frame feedback
   loop, not a one-time seed problem; a limb missing at the seed is usually still
   missing mid-climb.
5. **Sticky hysteresis** (decay the expansion over several frames) — deferred:
   adds cross-frame state and breaks `deriveClimberCrop`'s purity; only warranted
   if diagnostics show box-size oscillation, which the normal pad + motion margin
   are expected to prevent.

## Consequences

- **A missing limb now enlarges the crop**, lowering effective input resolution on
  that side until the limb is recovered — bounded by the relative cap and tracked
  by `limbExpandedFrames` for tuning.
- **The radius leans on the mirror limb.** A pose missing *both* sides of a limb
  type falls back to the coarser torso ratio; both-sides-missing poses therefore
  size less precisely (and more often hit the cap).
- **The constants are starting values**, to be verified against
  `climberFrameCoverage` and `limbExpandedFrames` in the dev diagnostics, like the
  ADR 0013 crop constants.
