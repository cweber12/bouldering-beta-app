# Filmstrip Wrong-stretch bar, jump-to-next-Wrong-start, inherited hint

Status: done
Branch: feat/wff-03-filmstrip-bar-jump
Merged: 7cbf11a

## Parent

`.scratch/calibration-wrong-forward-fill/PRD.md`

## What to build

Make the forward-fill structure legible and navigable across a long (1000+ frame)
Test Video.

- **Wrong-stretch bar.** The filmstrip draws a continuous caution bar over each
  derived Wrong stretch, **bridging seeded-absent gaps** so a single wrong-person
  episode reads as one span. The redundant per-frame Wrong dot is dropped; the
  seeded-absent dot is kept so no-detection gaps stay individually legible under
  the bar.
- **Jump to next Wrong stretch.** The former "Jump to next flagged stretch"
  control is repurposed to land on the **start of the next Wrong stretch** (the
  first seeded frame of the next Wrong segment), so the author walks episode to
  episode — including stale flags carried from the old implementation. Backed by
  a Wrong-stretch enumeration helper in the scaffold utils.
- **Inherited-source hint.** When the reviewer is parked on a _derived_ frame
  (one inheriting its flag from an earlier control point), the active flag is
  shown with an "inherited from mm:ss.s" caption naming the governing boundary,
  so the author can find the boundary to move.

## Acceptance criteria

- [x] A continuous caution bar spans each derived Wrong stretch and bridges an
      absent gap within a stretch (no break across the gap).
- [x] The per-frame Wrong dot is removed; the seeded-absent dot is retained.
- [x] The Jump control lands on the start of the next Wrong stretch and is
      disabled when none follows the current frame.
- [x] A derived frame in the reviewer shows the active flag plus an
      "inherited from mm:ss.s" caption identifying the governing boundary; a frame
      that is itself a control point shows no such caption.
- [x] Filmstrip component tests cover the bar rendering and gap-bridging, the
      retained seeded-absent / dropped Wrong dot, and the Jump target; the
      reviewer test covers the inherited hint. `npx tsc --noEmit`,
      `npx eslint .`, and the targeted `npx vitest run` pass.

## Blocked by

- `.scratch/calibration-wrong-forward-fill/issues/01-forward-fill-core.md`
