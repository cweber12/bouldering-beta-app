# 10 - Landing four-phase renderer and real fallback

Status: ready-for-agent

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

## What to build

Build landing-specific replay rendering that executes the four-phase visual story over an 8-second item with deterministic timing, stable portrait framing, and a real full-data fallback item. This slice also adds a minimal pause/play control for motion compliance.

## User stories covered

- Deterministic four-phase visual progression.
- Route Overlay transformation legibility.
- Motion compliance and reduced-motion behavior.

## Acceptance criteria

- [ ] Rendering follows fixed windows at 0-45, 45-62, 62-80, and 80-100 percent within each 8-second item.
- [ ] Phase composition is correct: phase 1 shows starfield + video-space pose/trail; phase 2 fades trail/starfield and introduces matched source points; phase 3 introduces Route Photo and morphs ORB/pose to photo space; phase 4 fades matched points while Route Overlay completes.
- [ ] Stage layout remains stable (portrait container with explicit contain mapping for source and photo coordinate planes).
- [ ] Public caption renders required labels (`area`, Route name, `rating`) with readable contrast.
- [ ] Add one pause/play control with accessible label/keyboard reachability; pause freezes full replay clock (phase progression, pose progression, and crossfade timing) and resume continues from same elapsed point.
- [ ] Reduced motion starts on a static final Route Overlay frame and remains paused until explicit play.
- [ ] Replace fake fallback behavior with a real-data fallback item path.
- [ ] Tests cover phase boundary composition, stable framing, pause/resume clock behavior, and reduced-motion behavior.

## Blocked by

- .scratch/actionable/ui-public-landing-replay-curation/issues/09-versioned-replay-contract-and-projection.md
