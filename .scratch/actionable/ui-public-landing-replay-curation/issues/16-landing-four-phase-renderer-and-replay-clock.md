# 16 - Landing four-phase renderer and replay clock

Status: ready-for-agent

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

## What to build

Render one exported replay item on the landing hero as an 8-second four-phase
story, driven by a single replay clock.

Two things keep this slice small, and both are load-bearing:

1. **The renderer only lerps and crossfades.** The item carries both coordinate
   spaces, so the phase-3 morph is interpolation between two saved arrays — no
   OpenCV, no homography, no pose interpolation at runtime.
2. **There is exactly one clock.** Pause/play, offscreen, hidden tab, and
   reduced motion are inputs to one `useReplayClock`, not four independent
   effects. Splitting the clock is how freeze/resume drift bugs get in.

This slice replaces the signed-in personalization path in
`components/skeleton/XrayReplayDemo.tsx` and reads a single checked-in item.

## User stories covered

- Deterministic four-phase visual progression.
- Route Overlay transformation legibility.
- Motion compliance and reduced-motion behavior.

## Acceptance criteria

- [ ] Add `useReplayClock` returning elapsed milliseconds from a single source
      of truth, paused when **any** of: user paused, container offscreen, tab
      hidden.
- [ ] Pause freezes and resume continues from the same elapsed value with no
      jump in phase progression, pose progression, or crossfade timing.
- [ ] Rendering follows fixed windows at 0-30, 30-45, 45-80, and 80-100 percent
      within each 8-second item.
- [ ] Phase composition is correct: phase 1 starfield + video-space
      pose/trail; phase 2 fades starfield and introduces matched source points;
      phase 3 introduces the Route Photo and morphs matched points and Skeleton
      into photo space; phase 4 fades matched points while the Route Overlay
      completes.
- [ ] Pose playback is continuous across all four phases, sampled by
      clip-relative elapsed time — phases change the space drawn in, never the
      playback rate.
- [ ] Holds reveal progressively on their clip-relative `t` through phases 3-4,
      using the existing `pipeline/holds/holdsOverlay` reveal behavior.
- [ ] Stage layout is stable: portrait container with explicit contain mapping
      for the source and photo coordinate planes, so nothing reflows at the
      morph.
- [ ] Public caption renders `area`, Route name, and `rating` with readable
      contrast.
- [ ] One pause/play control with an accessible label and keyboard
      reachability.
- [ ] Reduced motion starts on a static final Route Overlay frame and stays
      paused until explicit play.
- [ ] Signed-in personalized landing replay behavior is removed.
- [ ] On asset fetch or guard failure the hero degrades to its text content
      without crashing. No fallback asset and no fallback load path.
- [ ] Tests cover phase boundary composition, stable framing, pose sampling by
      elapsed time, clock freeze/resume across all pause inputs, and
      reduced-motion behavior.

## Blocked by

- .scratch/actionable/ui-public-landing-replay-curation/issues/15-replay-clip-contract-and-authoring-export.md