# PRD: Public Landing Replay Curation

Status: in-progress
Disposition: actionable

## Problem Statement

The landing replay currently mixes a bundled demo path with signed-in user
sampling and does not provide a deterministic, portfolio-grade public sequence.
We need a private maintainer workflow that turns known-good Runs into
checked-in replay artifacts while keeping the public hero stable and passive.

## Solution

Curate a playlist of short clips drawn from different Runs, and deliver it as a
single static asset:

1. In a hidden development-only route, pick a saved Run and a 20-second window
   of it, attach a wall still and a Route Photo, and run the existing ORB match.
2. Export that clip as one JSON item and check it into the repo.
3. The landing hero fetches one playlist asset and plays its items in file
   order.

### Design invariant: the exported item is pure geometry

Everything expensive — ORB matching, homography, Hold projection, Skeleton
transform — runs **once at authoring time, in the browser**, using the pipeline
and hooks that already exist. The exported item stores only the *results*.

At runtime the landing renderer **only lerps and crossfades**. No OpenCV, no
MediaPipe, no homography, no pose interpolation on the landing page. Phase 3's
"morph into Route space" is a plain interpolation between two saved coordinate
arrays.

This invariant is what keeps the renderer small, and it is the reason the
authoring step must save both coordinate spaces rather than one plus a matrix.

### Item contract (v1)

Every coordinate is normalized `[0,1]` — source points in source video space,
photo points in Route Photo space — so nothing depends on render resolution.

```jsonc
{
  "version": 1,
  "items": [
    {
      "id": "run-1750000000-boulder-problem",
      "label": { "area": "…", "route": "…", "rating": "V4" },
      "duration": 20,
      // `webp` is the optional wall still, in this same coordinate space
      "source": { "w": 1080, "h": 1920, "webp": "data:image/webp;base64,…" },
      "photo": { "w": 1200, "h": 1600, "webp": "data:image/webp;base64,…" },
      "starfield": [{ "x": 0.12, "y": 0.44 }],
      "matches": [{ "sx": 0.12, "sy": 0.44, "px": 0.31, "py": 0.52 }],
      "poses": [
        {
          "t": 0.0,
          // [BlazePose landmark index, x, y, score]
          "source": [[15, 0.4, 0.3, 0.9]],
          "photo": [[15, 0.5, 0.4, 0.9]]
        }
      ],
      "holds": [{ "x": 0.3, "y": 0.5, "kind": "hand", "side": "left", "t": 1.2 }]
    }
  ]
}
```

`poses[].t` and `holds[].t` are **clip-relative captured seconds** (0 at the
clip's first frame), spanning `duration`.

### Capture, screen time, and playback rate

Captured seconds and screen seconds are separate quantities. A clip captures
**20 seconds** of climbing and the hero spends **12 seconds** showing it, so the
figure plays at ~1.7×. That is what makes a clip read as a climb rather than a
fragment: pose detection runs at 2 Hz and the stored track is bone-space
interpolated up from there, so replaying above 1× discards no motion that was
ever measured — it buys a longer window of the ascent for the same hero dwell.

Screen time is capped at 12s deliberately: the phase windows are fractions of it,
and much past that the phase-3 morph starts to drag.

Poses export at **5 Hz**, not the stored track's 10 Hz. The renderer samples by
time and interpolates, and the stored 10 Hz was itself inferred from 2 Hz
detections, so the halved payload costs nothing visible. Landmarks serialize as
`[index, x, y, score]` rather than named objects for the same reason — the names
outweighed the geometry they labelled.

### Phase timing

The pose plays continuously across the whole clip. Phases control only *which
space* the figure is drawn in and what else is on screen — they never change
playback speed.

1. 0-15%: the wall still rises out of the dark stage behind the video-space
   Skeleton; 15-30%: the starfield ignites on that still
2. 30-45%: starfield fades while matched source points emerge
3. 45-80%: the wall still cross-dissolves into the Route Photo while matched
   points and Skeleton morph toward Route Photo space
4. 80-100%: matched points fade out while the Route Overlay completes

The morph (phase 3) is the payoff, so it gets the largest share.

## User Stories

See issue slices 15-17 in `.scratch/actionable/ui-public-landing-replay-curation/issues/`.

## Branch and Start Order

Use one issue per branch, branched from `main`, in this order:

1. Start issue 15 first.
   Branch: `feat/landing-replay-clip-export`
2. Start issue 16 after issue 15 lands.
   Branch: `feat/landing-replay-renderer`
3. Start issue 17 after issue 16 lands.
   Branch: `feat/landing-replay-playlist`

Dependency summary:

- 15 has no blockers.
- 16 blocked by 15.
- 17 blocked by 16.

## Implementation Decisions

- One global playlist for all visitors. Remove signed-in personalized landing
  replay behavior.
- Curation is private maintainer tooling on a hidden `/dev` route, not a
  user-facing product surface.
- No runtime publish endpoint, no allowlist role, no repository writes from the
  UI. The authoring route downloads a file; the maintainer commits it.
- Authoring composes what already exists: `useImageMatcher` (ORB match + gated
  homography), `buildSkeletonFrames` (photo-space Skeleton), `useHolds`
  (photo-space Holds). The new code is a clip-window picker and a serializer.
- Source material is maintainer-owned, known-good Fixed Capture Runs.
- Route Photo is embedded in the export as compressed WebP data.
- Playlist holds 1-5 items; **order is array order in the checked-in file**.
  Reordering means editing the file.
- Capture window (20s) and screen window (12s) are separate constants, so the
  clip's playback rate falls out of the pair rather than being its own knob.
  Items carry their own captured `duration`, so the rate is per item.
- Each item may carry an uncropped **wall still** from its own video, in the
  source coordinate space, so phase 1 opens on the real wall. Optional by
  design: an item without one opens on the dark stage, and an already-curated
  asset stays valid.
- The hero stage takes its shape from the first item's source plane rather than a
  fixed portrait, so landscape footage is not letterboxed into a strip. One shape
  for the whole playlist, so a handoff never reflows.
- The hero draws **no Holds**. They are a secondary feature and a ring revealing
  mid-morph competes with the payoff. Items still carry them, so this is a
  render decision, not a contract change.
- Public labels include only `area`, Route name, and `rating`.
- Hero is passive: no previous/next navigation; one pause/play control for
  motion compliance.
- Reduced motion starts on a static final Route Overlay frame.

### Deliberately excluded

These were specified in the superseded slices 09-14 and are dropped as
ceremony disproportionate to a static file that ships in the same bundle as the
page reading it:

- **No standalone fallback artifact and no fallback load path.** The playlist is
  one JSON in `public/`, same origin as the page's own JavaScript. If it fails
  to load, everything else already failed. The hero degrades to its text
  content.
- **No version negotiation, no strict parser, no export round-trip
  validation, no per-item skip.** Producer and consumer are the same commit of
  the same repo. Keep the `version: 1` field and a single `isReplayItem()`
  guard so a hand-edit cannot crash the hero.
- **No reorder UI and no designated default item.** Order is file order; the
  default disappeared with the fallback artifact.
- **No approval gating or candidate eligibility filtering.** One maintainer, one
  dev route — "approval" is clicking Export.

## Testing Decisions

- Verify the serializer's output shape, coordinate normalization, and
  clip-relative rebasing of pose and Hold timestamps.
- Verify deterministic phase composition at each boundary.
- Verify one replay clock: pause/play, offscreen, hidden tab, and reduced motion
  all freeze and resume the same elapsed value with no jump.
- Verify cycling advances in file order with a stable handoff.

## Out of Scope

- Panning Capture support.
- Cross-user curation.
- Runtime/admin publish APIs and UID allowlists.
- Randomized order and per-item timing overrides.
- Generalized replay quality scoring.
- Previous/next item navigation controls.

## Further Notes

- Keep old issue slices 01-14 for traceability with `wontfix` +
  `Superseded-by` pointers.
- Leave the shared scan loading renderer (`XrayStage`) behavior stable; the
  landing renderer is landing-specific.
