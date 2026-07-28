# Declare each API response type once

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-consolidation-cleanup/PRD.md`

## Blocked by

Nothing. Independent of issues 01 and 02, though it touches some of the same route files — pick it
after them to avoid a needless conflict.

## What to build

Four response shapes are declared more than once, by hand, on both sides of the API boundary. A
server-side field addition today updates one declaration and silently leaves the others believing
something different.

**`ClimbSummary` — 5 declarations.** Exported from
`app/api/profile/[userId]/climbs/page/route.ts:18`, then re-declared structurally identically in
`app/profile/page.tsx:43`, `app/profile/[userId]/page.tsx:31`,
`components/compare/CompareClimbRail.tsx:13`, and `components/routes/ClimbGrid.tsx:15`.

**`ClimbPageResponse` — 2 declarations.** `app/profile/page.tsx:56` and
`app/profile/[userId]/page.tsx:44`.

**`ClimbPin` — 2 declarations.** `app/api/profile/[userId]/pins/route.ts:17` and
`components/map/ClimbsMap.tsx:21`.

**`CorpusItem` — 2 declarations.** `app/api/dev/shared.ts:101` (server) and `harness/corpus.ts:11`
(client mirror, after the issue-03 rename in the foundation PRD). Roughly 15 fields —
`truthStale`, `truthDrifted`, `seedReady`, `untrackable`, `pairedRunCount` and the rest — kept in
sync by hand, with a comment in the file already acknowledging the duplication.

Give each one declaration and import it everywhere. Placement:

- The three climb/profile types are the profile API's response contract. Put them where both
  sides can reach them without a layer violation — `storage/` is the leaf both `app/api/` and
  `components/` may import, and `docs/agents/profile.md` already documents this storage format, so
  it should be updated to point at the new home.
- `CorpusItem` is Harness domain data. It belongs in `harness/`, which `app/api/dev/shared.ts` may
  import under the target graph.

**Compare the declarations before merging them.** They are described as structurally identical,
but verify field by field: an optional-vs-required difference or a widened union in one copy is
exactly the kind of drift this issue exists to stop, and the merged type must be the one that is
correct for every consumer, not the loosest.

## Acceptance criteria

- [ ] `ClimbSummary`, `ClimbPageResponse`, `ClimbPin`, and `CorpusItem` each have exactly one
      declaration in the repo.
- [ ] Every former declaration site imports the shared type instead.
- [ ] Any field-level difference found between copies is recorded in `## Comments` with the
      resolution and why it is correct for every consumer.
- [ ] The shared types live where both server and client may import them without violating the
      layer boundary rules — `npx eslint .` confirms this.
- [ ] `harness/corpus.ts`'s comment acknowledging the `CorpusItem` duplication is removed along
      with the duplication.
- [ ] `docs/agents/profile.md` points at the new home for the profile response types.
- [ ] No runtime behaviour changes — this issue moves types only, and `tsc` is the proof.
- [ ] `npx tsc --noEmit` passes with zero output.
- [ ] `npx eslint .` and **full** `npx vitest run` pass.

## Comments

- `app/profile/page.tsx` (1,200 lines) and `app/profile/[userId]/page.tsx` (623) are near-parallel
  implementations of the same paginated-climbs, pins, follow-state, and detail-modal logic — which
  is why they each re-declare the same two types. Collapsing those pages is deliberately out of
  scope for this PRD (both have zero test coverage); this issue removes the type duplication only.
