# 02 - Playlist assembly and multi-item asset gate

Status: ready-for-agent

## Parent

- .scratch/actionable/ui-landing-replay-multi-clip/PRD.md

## What to build

Make assembling a multi-clip playlist mechanical and checked, instead of
hand-editing three-quarters of a megabyte of base64.

Two halves, both small: a script that concatenates exports in argument order and
refuses the obvious mistakes, and an extension of the checked-in asset gate to
the invariants that only exist once there is more than one item.

The script writes a file. It does not touch S3, does not read the repo's git
state, and does not publish anything — same posture as the authoring route.

## User stories covered

- Adding a clip is a command, not a merge conflict waiting to happen.
- Mistakes surface at assembly time, not on the landing page.

## Acceptance criteria

- [ ] Add `scripts/merge-landing-replay.mjs` taking N exported files and writing
      the playlist, **in argument order** — argument order is play order.
- [ ] It refuses, with a readable message rather than a stack trace: more than
      `REPLAY_PLAYLIST_MAX` items, duplicate ids, an item that fails
      `isReplayItem`, and a missing or unreadable input.
- [ ] It warns (but still writes) when items disagree on source aspect ratio,
      naming which item letterboxes and that item 0 sets the stage.
- [ ] It reports the written asset's size and per-clip breakdown, so the payload
      budget is visible at the moment it is spent.
- [ ] Extend `__tests__/pipeline/landingReplayAsset.test.ts` to multi-item
      invariants: distinct ids across the playlist, a total-size ceiling, and an
      aspect-consistency assertion that fails loudly rather than warning.
- [ ] README documents the script as the way to assemble a playlist, replacing
      the hand-merge instructions.
- [ ] Tests cover concatenation order, duplicate ids, over-cap input, and
      mismatched aspects.

## Blocked by

- .scratch/actionable/ui-landing-replay-multi-clip/issues/01-export-payload-trim.md
