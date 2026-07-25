# 02 - Playlist assembly and multi-item asset gate

Status: in-progress
Branch: feat/landing-replay-assembly

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

- [x] Add `scripts/merge-landing-replay.mjs` taking N exported files and writing
      the playlist, **in argument order** — argument order is play order.
- [x] It refuses, with a readable message rather than a stack trace: more than
      `REPLAY_PLAYLIST_MAX` items, duplicate ids, an item that fails
      `isReplayItem`, and a missing or unreadable input.
- [x] It warns (but still writes) when items disagree on source aspect ratio,
      naming which item letterboxes and that item 0 sets the stage.
- [x] It reports the written asset's size and per-clip breakdown, so the payload
      budget is visible at the moment it is spent.
- [x] Extend `__tests__/pipeline/landingReplayAsset.test.ts` to multi-item
      invariants: distinct ids across the playlist, a total-size ceiling, and an
      aspect-consistency assertion that fails loudly rather than warning.
- [x] README documents the script as the way to assemble a playlist, replacing
      the hand-merge instructions.
- [x] Tests cover concatenation order, duplicate ids, over-cap input, and
      mismatched aspects.

## Blocked by

- .scratch/actionable/ui-landing-replay-multi-clip/issues/01-export-payload-trim.md

## Comments

**The script mirrors the contract rather than importing it.** `scripts/*.mjs`
files are run by bare `node` with no build step, and
`pipeline/overlay/landingReplayItem.ts` is TypeScript that itself imports through
the `@/` alias, so the guard and the two constants are duplicated in the script.
The duplication is checked rather than trusted:
`__tests__/scripts/mergeLandingReplay.test.ts` imports both sides and asserts the
script's `isReplayItemLike` returns exactly what `isReplayItem` returns across a
fixture matrix, and reads `REPLAY_PLAYLIST_MAX` from the contract when asserting
the over-cap refusal. Either side drifting fails that suite.

**Aspect tolerance is now a contract constant.** `REPLAY_ASPECT_TOLERANCE`
(0.02) was added to `landingReplayItem.ts` so the script's warning and the asset
gate's failure are the same threshold rather than two hand-picked numbers.

**The asset gate's size ceiling is per clip *and* total** — 420 KB and 1.2 MB,
the PRD's own budget. A measured 3-clip playlist assembled from the checked-in
clip comes to 1018 KB, so the ceiling has room but not slack: a fourth clip busts
it, which is the intended loud failure rather than a silent page-weight
regression.

**Verified against the real asset**, not just fixtures: assembling three clips
derived from `public/landing-replay.json` (one re-shaped to portrait) produced
the letterbox warning naming item 1 and item 0's stage, the per-clip breakdown,
and a 1018 KB total; the duplicate-id, over-cap, missing-input and no-argument
paths each exited 1 with a single readable line and no stack trace.
