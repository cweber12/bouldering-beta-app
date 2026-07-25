# 16 - Landing four-phase renderer and replay clock

Status: done
Branch: feat/landing-replay-renderer
Merged: 1c2e8dd

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

- [x] Add `useReplayClock` returning elapsed milliseconds from a single source
      of truth, paused when **any** of: user paused, container offscreen, tab
      hidden.
- [x] Pause freezes and resume continues from the same elapsed value with no
      jump in phase progression, pose progression, or crossfade timing.
- [x] Rendering follows fixed windows at 0-30, 30-45, 45-80, and 80-100 percent
      within each 8-second item.
- [x] Phase composition is correct: phase 1 starfield + video-space
      pose/trail; phase 2 fades starfield and introduces matched source points;
      phase 3 introduces the Route Photo and morphs matched points and Skeleton
      into photo space; phase 4 fades matched points while the Route Overlay
      completes.
- [x] Pose playback is continuous across all four phases, sampled by
      clip-relative elapsed time — phases change the space drawn in, never the
      playback rate.
- [x] Holds reveal progressively on their clip-relative `t` through phases 3-4,
      using the existing `pipeline/holds/holdsOverlay` reveal behavior.
- [x] Stage layout is stable: portrait container with explicit contain mapping
      for the source and photo coordinate planes, so nothing reflows at the
      morph.
- [x] Public caption renders `area`, Route name, and `rating` with readable
      contrast.
- [x] One pause/play control with an accessible label and keyboard
      reachability.
- [x] Reduced motion starts on a static final Route Overlay frame and stays
      paused until explicit play.
- [x] Signed-in personalized landing replay behavior is removed.
- [x] On asset fetch or guard failure the hero degrades to its text content
      without crashing. No fallback asset and no fallback load path.
- [x] Tests cover phase boundary composition, stable framing, pose sampling by
      elapsed time, clock freeze/resume across all pause inputs, and
      reduced-motion behavior.

## Blocked by

- .scratch/actionable/ui-public-landing-replay-curation/issues/15-replay-clip-contract-and-authoring-export.md

## Comments

Implementation notes:

- Composition arithmetic: `pipeline/overlay/landingReplayFrame.ts`
  (`composeReplayFrame`, `clipProgress`, `containRect`, `sampleReplayPose`,
  `morphKeypoints`) — framework-agnostic, so every phase boundary and the pose
  sampling are testable without a canvas. Clock: `hooks/useReplayClock.ts`.
  Renderer: `components/skeleton/LandingReplay.tsx`.
- The stage is a **fixed 9:16 portrait frame**, not the item's own aspect. Both
  planes are contained into it once per item, so neither the morph nor (issue 17)
  an item handoff can reflow the layout.
- The clock's pause inputs are derived, not written by effects: reduced motion
  parks it on `staticElapsedMs` (the clip duration) while the visitor has not
  touched the control. `clipProgress` therefore reads a whole number of clips as
  the *end* of a clip, which is what makes that parked value the finished Route
  Overlay rather than the starfield.
- The wake is composited from its own layer at the frame's trail alpha, because
  `drawSkeleton` owns `globalAlpha` for confidence dimming and would overwrite a
  per-call fade. Older wake poses recede by mixing toward `--color-scan-stage`.
- Removed with the signed-in path: `XrayReplayDemo`, `useReplayDriver`,
  `replayData.mjs`, `scripts/make-landing-demo.mjs`, `public/landing-demo.json`
  and the `make:landing-demo` script — the PRD drops the fallback artifact and
  its load path. `XrayStage` stays; the scan loading screen still uses it.
- **No playlist asset is checked in yet.** `public/landing-replay.json` is issue
  17's deliverable, so until it lands the hero degrades to the page's text
  content (verified). The renderer was validated against a synthetic clip in a
  browser: four-phase progression, morph into photo space, Hold reveal, loop
  wrap, pause freeze/resume, and the reduced-motion static final frame.
