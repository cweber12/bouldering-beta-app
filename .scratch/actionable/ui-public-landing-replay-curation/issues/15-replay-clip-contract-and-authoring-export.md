# 15 - Replay clip contract and authoring export

Status: done
Branch: feat/landing-replay-clip-export
Merged: d55760b

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

## What to build

Define the v1 replay item contract and build the hidden authoring route that
produces one. The route composes existing surfaces — there is no new matching,
homography, or Skeleton-transform code in this slice.

The flow is: pick a saved Run → choose an 8-second window → attach a Route
Photo → run the existing ORB match → download one JSON item.

The output must satisfy the PRD's design invariant: **pure geometry only**, both
coordinate spaces baked, so the landing renderer never touches OpenCV.

## Reuse map

Everything below already exists; wire it, do not reimplement it:

- `hooks/useImageMatcher.ts` — ORB match against the Run's stored
  `orbFeatures`, returning `matches` and the gated `homography`.
- `pipeline/overlay/skeletonRenderer.ts` `buildSkeletonFrames` — photo-space
  Skeleton frames from the gated homography.
- `hooks/useHolds.ts` — projects stored `StoredHold`s into photo space.
- `components/route/RouteConsole.tsx` — reference for Run loading + photo
  attach + match wiring.

## User stories covered

- Private maintainer tooling for curation.
- One reviewable clip built at a time.
- Privacy-safe export surface for portfolio delivery.

## Acceptance criteria

- [x] Define a `LandingReplayItem` TypeScript type plus a root
      `{ version: 1, items: [...] }` wrapper matching the contract sketched in
      the PRD.
- [x] Add one narrow runtime guard (`isReplayItem`) sufficient to stop a
      hand-edited file from crashing the hero. No version negotiation, no
      strict parser, no export round-trip validation.
- [x] Add an unlinked development-only route for clip authoring, behind normal
      authentication, using only existing user-scoped read access.
- [x] Curator can select a saved Fixed Capture Run and scrub to a fixed-width
      8-second window with endpoint preview and segment playback.
- [x] Curator can attach a Route Photo and run the existing ORB
      match/homography validation, with the alignment result shown before
      export.
- [x] Export serializes: `label` (`area`, Route name, `rating`), source and
      photo dimensions, WebP-compressed Route Photo, starfield points, paired
      `matches` (source xy + photo xy), and per-pose **both** source-space and
      photo-space keypoints.
- [x] Export includes `holds` in photo space with `kind`, `side`, and
      `firstUseTime` rebased to clip-relative seconds.
- [x] `poses[].t` and `holds[].t` are clip-relative (0 at the window's first
      frame). All coordinates normalized `[0,1]`.
- [x] Export excludes private/source fields: user identity, notes, coordinates,
      S3 keys, ORB descriptors, the homography matrix, and any Run metadata not
      in `label`.
- [x] Export downloads a file. No publish endpoint, no allowlist role, no
      repository write from the UI.
- [x] Tests cover serializer output shape, coordinate normalization,
      clip-relative rebasing, private-field exclusion, and the runtime guard.

## Blocked by

None - can start immediately

## Comments

Implementation notes for issue 16 (the renderer):

- Contract + guard: `pipeline/overlay/landingReplayItem.ts`. Serializer:
  `pipeline/overlay/landingReplaySerializer.ts`. Authoring route:
  `app/dev/landing-clip/page.tsx`.
- `photo.w/h` are the **WebP's** dimensions (what the hero draws). Photo
  coordinates are measured at match resolution and normalized against the
  serializer's `photoSpace` param — the two share an aspect ratio, so the
  normalized values are identical either way.
- A Hold already in use when the window opens reveals at `t = 0` rather than at
  a negative time; Holds first used after the window's end are dropped. Holds
  are sorted by reveal time.
- Authoring is Fixed Capture only. Panning Capture Runs, Runs with no reference
  ORB features, and pose tracks shorter than 8s are rejected with a notice
  rather than silently exported.
