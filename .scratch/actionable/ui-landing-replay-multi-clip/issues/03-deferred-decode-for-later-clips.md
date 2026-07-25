# 03 - Deferred decode for later clips

Status: in-progress
Branch: feat/landing-replay-deferred-decode

## Parent

- .scratch/actionable/ui-landing-replay-multi-clip/PRD.md

## What to build

Stop the hero's first frame waiting on clips it is not showing.

`LandingReplay` currently decodes **every** item's wall still and Route Photo the
moment the playlist resolves. With one clip that is two images; with three it is
six, and the ones that matter — item 0's — compete with four that will not be
seen for twelve seconds.

The fetch stays as it is. One asset, one request, no fallback path: that is a
curation-PRD invariant and this slice does not reopen it. Only decode moves.

## User stories covered

- The hero opens as fast with three clips as with one.

## Acceptance criteria

- [x] Item 0's images decode first; later items decode behind them, and a later
      item's decode never delays the first frame.
- [x] Each item's images are decoded before its slot opens, so a handoff never
      cuts to a clip whose backdrop is missing.
- [x] The existing degradation holds unchanged: an item whose image has not
      resolved still plays, against the dark stage.
- [x] No change to the fetch: still one request for one asset, still no fallback
      load path.
- [x] Tests cover decode ordering and that a pending later decode does not block
      the first item rendering.

## Blocked by

- .scratch/actionable/ui-landing-replay-multi-clip/issues/01-export-payload-trim.md

## Comments

**Decode moved into `hooks/useReplayImages.ts`.** The component's eager
"decode everything the moment the playlist resolves" effect became a chain in
play order: item 0's pair concurrently, then item 1's once both of item 0's have
settled, and so on. `LandingReplay.tsx` now just consumes the id-keyed map.

**Ordering carries the "before its slot opens" guarantee without a clock.**
Gating each item's decode on the playhead was considered and rejected: item N's
decode starts behind at most N-1 others, and each slot is
`REPLAY_ANIMATION_SECONDS` (12 s) long, so the chain runs far enough ahead of the
playhead that watching the clock would only be a more complicated route to the
same state — and would put a second `elapsedMs` dependency into a decode effect.

**Failure now settles rather than hanging.** The old effect wired only `onload`,
so an undecodable backdrop simply never resolved. Under a sequential chain that
would strand every clip behind it, so `onerror` (and a rejected `decode()`)
resolves the step with `null`: that clip keeps its dark stage and the queue moves
on. Covered by a test.

**`img.decode()` where the browser has it, `onload` where it does not.**
`onload` only promises the bytes arrived — the bitmap decode then happens inside
the first `drawImage`, synchronously, on the animation frame. Waiting on
`decode()` is what makes "decoded before its slot opens" literal. jsdom
implements no `decode()`, so both branches are exercised by the hook suite.

**Fetch untouched** — one request for one asset, no fallback path, as the
curation PRD requires.
