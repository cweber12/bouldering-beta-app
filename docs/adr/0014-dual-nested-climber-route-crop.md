# Dual nested Climber/Route crop replaces the locked Climber + full-frame Route

## Status

accepted

Supersedes ADR 0013 decision 1 (the Climber crop shown **locked**, no resize) and
decision 4 (the Route/Wall crop defaulting to the **whole frame**). Keeps ADR
0013's core: the Climber tap drives identity, and the **per-frame** detection
crop stays landmark-derived and motion-aware during the scan.

## Context

In Step 2 the User taps the Climber, then frames the Route for route-photo
matching. ADR 0013 showed the tap-derived Climber box **locked** and put the
Climber and Route on a segmented toggle (one editable at a time), with the Route
defaulting to the full frame so ORB had maximum wall texture.

Two rough edges remained:

- **A bad tap had no manual recovery.** When click-time detection mis-sized the
  seed box (or found no pose and dropped the default fallback), the User could
  not nudge the search region; they could only re-tap and hope. ADR 0013 removed
  the resize affordance because hand-framing did not improve *tracking* — but the
  seed box is also the **first-acquisition search region**, where a hand
  correction is legitimately useful.
- **The full-frame Route included the floor/pad.** Below the climber is ground,
  crash pad, and spectators — ORB noise, not wall plane. A full-frame Route fed
  those features into route-photo matching.

The toggle also meant the two related boxes were never visible together, so the
nesting relationship (the Climber sits *inside* the Route) was implicit.

## Decision

Show both crops at once, both adjustable, with the Climber dominant:

1. **Both boxes visible and adjustable; toggle removed.** After the tap, the
   inner **Climber** box and the outer **Route** box are both shown and directly
   grabbable (`DualCropOverlay`): inside the Climber moves the Climber, the ring
   between moves the Route, each box's handles resize that box. The Climber is
   layered on top. Re-identifying the Climber is the **Re-tap** button, not a tap
   on the boxes.
2. **Editing the Climber overrides the seed only.** A manual Climber adjustment
   changes the first-acquisition search region and the lighting-analysis region
   (`climberCropPx`). The per-frame adaptive crop still re-derives from landmarks
   during the scan, so ADR 0013's tracking is unchanged.
3. **Containment physics (`utils/cropContainment.ts`).** The Climber pushes the
   Route out so the Route always contains it; the Route can never cross inside
   the Climber. The push is **grow-only** — a Route edge stays where it was
   pushed when the Climber later retreats. All three reduce to one operation,
   `containRoute` (a frame-clamped min/max union that never shrinks a Route
   already containing the Climber).
4. **Route default hugs the climber's bottom.** `defaultRouteAroundClimber` is
   near full-frame but pulls the **bottom edge up to the Climber's bottom**,
   trimming the floor/pad (ORB noise) while keeping the wall texture above and
   beside the climber that route-photo matching needs.
5. **Slightly larger initial Climber padding.** The tap-derived seed box uses
   `SEED_CROP_PAD = 0.85` (vs the in-scan `DEFAULT_CROP_PAD = 0.6`) so the box
   the User sees and adjusts comfortably surrounds the climber. Only the seed is
   widened; the in-scan crop keeps its tuned padding.

## Considered options

1. **Dual nested boxes, Climber-dominant, grow-only push** (chosen) — restores a
   useful manual seed correction and an explicit nesting relationship without
   regressing landmark tracking or starving ORB (the Route stays large).
2. **Keep the locked Climber (status quo, ADR 0013)** — rejected: no recovery for
   a mis-sized seed, and the floor/pad stays in the Route.
3. **Tight, climber-hugging Route** — rejected again (as in ADR 0013 decision 4):
   it starves ORB of wall features and breaks route-photo matching. Trimming only
   the *bottom* keeps the side/top texture.
4. **Spring-back (Route re-hugs the Climber when it retreats)** — rejected: the
   Route would silently resize while the User is only adjusting the Climber.
   Grow-only is less surprising.
5. **Full per-frame Climber override** — rejected: reverses ADR 0013's adaptive
   crop; reaching limbs clip again.

## Consequences

- **ADR 0013's "the Climber can no longer be hand-framed" no longer holds** for
  the seed. The per-frame crop is still landmark-derived, so the warning about
  hand-framing hurting tracking is moot (the manual box only seeds acquisition).
- **Coincident edges favour the Climber.** When a Climber edge sits exactly on a
  Route edge (e.g. the default shared bottom), the Climber's handle is on top, so
  that Route edge is grabbed by pushing the Climber rather than dragging the Route
  handle directly. Acceptable: the grow-only push is the intended way to extend
  the Route past the Climber.
- **`DualCropOverlay` is a second crop component.** `CropBoxOverlay` stays the
  single-box overlay for its five other call sites; the dual-box hit-testing and
  the containment helpers are isolated and unit-tested.
