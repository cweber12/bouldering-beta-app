# 03 - Deferred decode for later clips

Status: ready-for-agent

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

- [ ] Item 0's images decode first; later items decode behind them, and a later
      item's decode never delays the first frame.
- [ ] Each item's images are decoded before its slot opens, so a handoff never
      cuts to a clip whose backdrop is missing.
- [ ] The existing degradation holds unchanged: an item whose image has not
      resolved still plays, against the dark stage.
- [ ] No change to the fetch: still one request for one asset, still no fallback
      load path.
- [ ] Tests cover decode ordering and that a pending later decode does not block
      the first item rendering.

## Blocked by

- .scratch/actionable/ui-landing-replay-multi-clip/issues/01-export-payload-trim.md
