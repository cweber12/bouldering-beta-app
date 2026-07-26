# 17 - Playlist cycling, curated assets, and docs

Status: done
Branch: feat/landing-replay-playlist
Merged: 7f9ace1

## Parent

- .scratch/done/ui-public-landing-replay-curation/PRD.md

## What to build

Turn the single-item hero into a playlist, then curate and check in the real
content. This is the finalization slice: cycling behavior, the actual clips,
docs, and end-to-end QA.

Cycling is deliberately thin — order is array order in a checked-in file, so
there is no reorder UI, no designated default, and no per-item skip machinery.

## User stories covered

- Same curated experience for all visitors.
- Portfolio-ready curated content delivery.
- Artifact and documentation alignment.

## Acceptance criteria

- [x] Landing hero loads one global playlist asset containing 1-5 items and
      plays them in file order for all visitors.
- [x] Item handoff is deterministic: each item runs its full clip and hands off
      via an approximately 300 ms crossfade, driven by the same replay clock from
      issue 16. (Clip length revised from 8s to 20s captured over 12s of screen
      time — see the timing note below.)
- [x] Cycling wraps to the first item and continues indefinitely while the
      clock runs.
- [x] Use the private authoring route from issue 15 with real maintainer Runs
      and Route Photos to curate 1-5 clips, and check the exported playlist
      asset into the repo. (One clip: Maze of Death, V12, Bishop.)
- [x] Verify the checked-in asset's content surface is privacy-safe (labels
      only, no identity, notes, coordinates, keys, descriptors, or homography).
      `landingReplayAsset.test.ts` now runs un-skipped against it and passes.
- [x] Update README for the authoring workflow, the asset location, and the
      rollback path (revert the asset file).
- [x] Confirm legacy planning slices 01-14 remain superseded and linked for
      traceability.
- [x] Run end-to-end regression checks: phase behavior, cycling and handoff,
      graceful degradation when the asset is absent, reduced-motion output, and
      pause/play keyboard access. **Partly transferred, and since satisfied — see
      the closing note.**
- [x] Tests cover ordered cycling, handoff timing, and wrap behavior.

## Blocked by

- .scratch/done/ui-public-landing-replay-curation/issues/16-landing-four-phase-renderer-and-replay-clock.md

## Comments

Cycling, docs and the QA harness landed on `feat/landing-replay-playlist`, and the
first curated clip is checked in (see round 1 below). The one remaining criterion
is the browser regression pass, which needs a human's eyes. Everything else is
done and passing:

- Handoff model: every item owns one screen-length slot on the one replay clock,
  first 300 ms of each slot is the crossfade — the incoming clip plays from
  `t = 0` while the outgoing one holds **its own final frame** (the finished Route
  Overlay) and fades out beneath it. Letting the outgoing clock run on instead
  would wrap it straight back to its starfield. Arithmetic:
  `composePlaylistLayers` in `pipeline/overlay/landingReplayFrame.ts`.
- Slots are counted from the clock's origin, not within the current cycle, so the
  cold start is distinguishable from the wrap that lands on the same item: the
  hero opens on item 0 rather than dissolving in from the last item. The same
  property is what keeps reduced motion parked on item 0's finished overlay —
  `staticElapsedMs` of one clip length is slot 1 at local 0, i.e. the previous
  item held at its end.
- The renderer draws straight to the stage away from a handoff and only pays for
  the offscreen layer during the crossfade, so a per-item fade can never disturb
  the phase alphas inside an item.
- `readReplayPlaylist` reads file order and caps at `REPLAY_PLAYLIST_MAX` (5),
  dropping any item that fails the existing guard rather than rejecting the file.
- QA that does not need real content is automated instead of manual:
  ordered cycling, handoff timing, wrap, pause freeze/resume across the cycling,
  the over-long playlist cap, the layer compositing (via a recording 2D context —
  jsdom's `getContext` is null, so this path was otherwise untestable), keyboard
  reachability of the pause control, and the asset-absent degradation.
- `__tests__/pipeline/landingReplayAsset.test.ts` is the standing gate on the
  privacy criterion: it skips while no asset exists and, the moment one is
  committed, asserts v1/1-5 items, unique ids, contract-only keys, labels-only
  text, no private Run field names anywhere in the JSON, and clip-relative times.
  Confirmed it both passes on a well-formed asset and fails on a planted `notes`
  field before being removed again.

### Curation round 1 — findings from the first real clip

The first authored clip surfaced four things, all now fixed:

- **The export was never live.** A downloaded item does nothing until it is at
  `public/landing-replay.json`; the hero fetches that path and nothing else. The
  file was sitting in `~/Downloads`. Installed, and the export step's help text
  now names the destination path.
- **The stage was hard-coded 9:16 portrait** on the assumption ascents are shot
  vertically. The real clip is 1280×720 with a 2.14:1 Route Photo, which
  contained into a portrait box as a strip a quarter of the frame high. The stage
  now takes the **first item's source plane** and holds it for the whole playlist
  — one shape, so a handoff still cannot reflow the layout.
- **The authoring route's Holds preview was lying.** It hand-rolled sky/orange
  arcs _over_ the Skeleton, while every shipping surface draws the real
  ADR-0012 rings _beneath_ it. The preview now calls `drawHolds` with the same
  clustering and progressive reveal, so the curator approves what actually ships.
  The shipped ring look is unchanged — it was never the problem.
- **Phase 1 had nothing behind the figure.** Items may now carry an optional
  **wall still** (`source.webp`), an uncropped frame of the run's own video in
  the same coordinate space. The hero opens dark, raises the still, ignites the
  starfield on it, then cross-dissolves it into the Route Photo across phase 3 —
  `frameAlpha + photoAlpha` sums to 1 through the migration, so the two real
  photographs hand over without the stage showing through. Optional by design:
  the already-curated clip stays valid and simply opens dark.

### Curation round 2 — hero framing and Holds

- **The hero rendered at a fraction of its column.** The `<figure>` sits in a
  `flex flex-col items-center` parent, so with no explicit width it shrink-to-fits
  and the stage's own `w-full` resolved against the _caption's_ text width — the
  hero was as wide as "Maze of Death · Bishop V12". `w-full` on the figure fixes
  it; the height cap now only binds on portrait clips, which would otherwise run
  taller than the pitch beside them.
- **Holds are gone from the hero.** A ring lighting up mid-morph competes with the
  one thing the clip is for — the Skeleton arriving on the wall — and made the
  transition read as cluttered. Items still carry `holds`, so this is a render
  decision, not a contract change or a re-curation; re-enabling is a `drawHolds`
  call. A mocked-module test asserts the hero never calls it.

### Clip timing revision (8s → 14s → 20s captured / 12s on screen)

An 8-second clip did not capture enough of an ascent to read as a climb. The fix
separates two quantities the original constant conflated:

- `REPLAY_CAPTURE_SECONDS = 20` — the authoring window, how much climbing a clip
  holds. `REPLAY_ANIMATION_SECONDS = 12` — how long the hero spends showing it.
  Their ratio is the playback rate (~1.7×), and items carry their own captured
  `duration` so the rate is per item rather than global.
- The speed-up costs no fidelity: detection is 2 Hz and the stored track is
  bone-space interpolated up from there, so replaying above 1× discards nothing
  that was ever measured. Screen time stays at 12s because the phase windows are
  fractions of it — much past that and the phase-3 morph drags. Each widening of
  the capture window also raises the eligibility bar: a Run now needs 20s of
  detected pose track to be authorable at all.
- Phase windows stay on screen time; only `clipSeconds` (pose sampling and Hold
  reveal) runs on captured time. `TRAIL_STEP_S` is deliberately left in captured
  seconds, so the wake keeps the same length behind the figure and simply passes
  by faster.
- Payload paid for itself: poses export at 5 Hz instead of the stored 10 Hz, and
  landmarks serialize as `[index, x, y, score]` instead of named objects. A 14s
  clip was roughly 100 KB against the old 8s clip's ~250 KB; at 20s it is ~145 KB,
  still well under the original while carrying 2.5× the climbing. Both are safe because the renderer samples poses by time and
  interpolates.
- The authoring route previews the segment at the hero's rate, not real time, so
  the curator judges what visitors will see.

The PRD's contract sketch, phase-timing section and implementation decisions were
updated in the same commit.

To finish the issue: the checked-in clip predates the 20s window and the wall
still, so it plays at 1.17× and opens on the dark stage. Re-author it on
`/dev/landing-clip` with a still attached (and add up to four more), then walk the
hero once in a browser for the phase/handoff/reduced-motion pass — the only
acceptance criterion that still needs a human's eyes.

## Closing note — the regression criterion

Closed with the regression criterion **unticked rather than claimed**, because it
splits three ways:

- **Verified in the browser during curation.** Phase behaviour and the framing
  were iterated on directly against the live hero — the Holds pass, the stage
  aspect, the black beat, the photo lag and the morph speed all changed in
  response to watching it. Graceful degradation was observed too: the hero
  rendered nothing for the whole session before the asset was installed, which is
  exactly the specified behaviour.
- **Covered by tests, not by eye.** Reduced-motion output, pause/play keyboard
  access, and the asset-absent path are asserted in
  `__tests__/components/skeleton/LandingReplay.test.tsx`.
- **Not verifiable yet.** Cycling and handoff need at least two clips. One is
  checked in, so this part is blocked on curating more — it transfers to the
  multi-clip PRD rather than being ticked here.

Transferred to: `.scratch/done/ui-landing-replay-multi-clip/PRD.md`

### Satisfied, 2026-07-25

The transferred part is now done. The multi-clip PRD's issue 04 curated the
playlist to three clips — Maze of Death (Bishop, V12), Midnight Lightning
(Yosemite, V8) and Slashface (Joshua Tree, V4) — and the browser pass ran against
that asset: file order, the ~300 ms crossfade at each handoff, the wrap from item
2 back to item 0, and a pause taken mid-handoff freezing the dissolve rather than
snapping to either clip. Reduced motion, keyboard access and the asset-absent
path were re-confirmed by eye on the same asset, alongside the assertions that
already covered them.

The criterion is therefore ticked above. The evidence lives at
`.scratch/done/ui-landing-replay-multi-clip/issues/04-curate-the-set-and-playlist-qa.md`
(merged `f86604c`); the three-way split recorded here is kept as the reason it was
closed late.
