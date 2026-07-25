# 17 - Playlist cycling, curated assets, and docs

Status: in-progress
Branch: feat/landing-replay-playlist

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

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
      issue 16. (Clip length revised from 8s to 14s captured over 10s of screen
      time — see the timing note below.)
- [x] Cycling wraps to the first item and continues indefinitely while the
      clock runs.
- [ ] Use the private authoring route from issue 15 with real maintainer Runs
      and Route Photos to curate 1-5 clips, and check the exported playlist
      asset into the repo.
- [ ] Verify the checked-in asset's content surface is privacy-safe (labels
      only, no identity, notes, coordinates, keys, descriptors, or homography).
- [x] Update README for the authoring workflow, the asset location, and the
      rollback path (revert the asset file).
- [x] Confirm legacy planning slices 01-14 remain superseded and linked for
      traceability.
- [ ] Run end-to-end regression checks: phase behavior, cycling and handoff,
      graceful degradation when the asset is absent, reduced-motion output, and
      pause/play keyboard access.
- [x] Tests cover ordered cycling, handoff timing, and wrap behavior.

## Blocked by

- .scratch/actionable/ui-public-landing-replay-curation/issues/16-landing-four-phase-renderer-and-replay-clock.md

## Comments

Cycling, docs and the QA harness landed on `feat/landing-replay-playlist`. The
three unticked criteria all wait on the same thing — **curation itself**, which
needs the maintainer's signed-in browser, their saved Runs in S3, and their Route
Photos. None of that is reachable from an agent session, so no
`public/landing-replay.json` is checked in and the hero still degrades to the
page's text content (verified). Everything else is done and passing:

- Handoff model: every item owns one 8s slot on the one replay clock, and the
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

### Clip timing revision (8s → 14s captured / 10s on screen)

An 8-second clip did not capture enough of an ascent to read as a climb. The fix
separates two quantities the original constant conflated:

- `REPLAY_CAPTURE_SECONDS = 14` — the authoring window, how much climbing a clip
  holds. `REPLAY_ANIMATION_SECONDS = 10` — how long the hero spends showing it.
  Their ratio is the playback rate (~1.4×), and items carry their own captured
  `duration` so the rate is per item rather than global.
- The speed-up costs no fidelity: detection is 2 Hz and the stored track is
  bone-space interpolated up from there, so replaying above 1× discards nothing
  that was ever measured. Screen time stays at 10s because the phase windows are
  fractions of it — much past that and the phase-3 morph drags.
- Phase windows stay on screen time; only `clipSeconds` (pose sampling and Hold
  reveal) runs on captured time. `TRAIL_STEP_S` is deliberately left in captured
  seconds, so the wake keeps the same length behind the figure and simply passes
  by faster.
- Payload paid for itself: poses export at 5 Hz instead of the stored 10 Hz, and
  landmarks serialize as `[index, x, y, score]` instead of named objects. A 14s
  clip is roughly 100 KB against the old 8s clip's ~250 KB — 75% more climbing at
  40% of the bytes. Both are safe because the renderer samples poses by time and
  interpolates.
- The authoring route previews the segment at the hero's rate, not real time, so
  the curator judges what visitors will see.

The PRD's contract sketch, phase-timing section and implementation decisions were
updated in the same commit.

To finish the issue: author 1-5 clips on `/dev/landing-clip`, concatenate the
exported `items` arrays into `public/landing-replay.json`, run
`npx vitest run __tests__/pipeline/landingReplayAsset.test.ts` (now un-skipped),
and walk the hero once in a browser for the phase/handoff/reduced-motion pass.
