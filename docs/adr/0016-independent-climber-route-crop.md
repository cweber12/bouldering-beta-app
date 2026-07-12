# Independent Climber and Route crops replace the contain-the-Climber invariant

## Status

accepted

Supersedes ADR 0014 (dual-nested-climber-route-crop) decision 3 (the containment
physics) and decision 4's rationale. Keeps ADR 0014's decisions 1, 2, and 5: both
boxes are still shown together and directly grabbable (`DualCropOverlay`), a
manual Climber edit still overrides only the seed / lighting region, and the seed
box still uses the wider `SEED_CROP_PAD`.

## Context

ADR 0014 made the Route (the ORB wall region) a subordinate of the Climber: the
Climber pushed the Route out so the Route always contained it, and a Route edge
could never cross inside the Climber (`containRoute`). Two problems surfaced in
use:

- **The Route could not be trimmed to the rock face.** Because it was forced to
  contain the Climber — and the Climber box is a portrait figure standing in
  front of the wall — the Route always spanned at least the climber's full
  height and width. On a boulder that fills only part of the frame (see the
  Buttermilks screenshot: snow, hillside, and neighbouring boulders on every
  side), the user could not shrink the Route down to just the target face. That
  padded ORB with off-route features and hurt route-photo matching — the exact
  failure the Route framing exists to avoid.
- **The default box hid against the frame edge.** `defaultRouteAroundClimber`
  started full-width with its top and sides flush against the frame edge, so the
  handles sat on the very border and the box did not read as draggable.

## Decision

1. **The Climber and Route crops are independent.** Each is dragged and resized
   freely, clamped only to the frame `[0, 1]` and the minimum size. Removed
   `containRoute` and the cross-box coupling in the scan page handlers:
   `handleClimberCropChange` leaves the Route alone, and `handleWallCropChange`
   only frame-clamps. The user can now trim the Route down to just the rock face
   regardless of where the Climber sits.
2. **The default Route insets from the frame edges.** `defaultRouteAroundClimber`
   starts inset by `ROUTE_EDGE_PAD = 0.05` on the top and sides (widening past
   the pad only when the Climber spills toward an edge), with the bottom still
   pulled up to the Climber's bottom to trim the floor/pad. The inset makes the
   box visibly grabbable; it is only a starting frame, not a constraint.
3. **The framing tip moves to the top of the frame.** In `StepSetDetection` the
   in-stage hint pill renders at the top; when minimized it collapses to an info
   icon in the top-right corner, clear of the boxes and the transport bar.

## Considered options

1. **Independent boxes, padded default** (chosen) — lets the Route be sized to
   the actual face while still starting somewhere sensible.
2. **Keep containment (ADR 0014)** — rejected: the whole point of the change is
   that the Route could not be trimmed below the climber's extent.
3. **Containment with a much smaller/looser Climber-derived minimum** — rejected:
   still couples the two boxes and still leaves off-route features whenever the
   climber is wide relative to the face.

## Consequences

- **ADR 0014's grow-only push and coincident-edge behaviour no longer apply.**
  Dragging the Climber never moves the Route. A Route edge dragged inside the
  Climber stays where the user put it.
- **The Route may exclude parts of the Climber.** Acceptable and intended: the
  Route is the ORB wall region, not a superset of the seed box. The Climber box
  independently seeds MediaPipe acquisition and lighting analysis.
- **`cropContainment.ts` keeps only `frameClampCrop` and
  `defaultRouteAroundClimber`.** `containRoute` and its unit tests are removed.
