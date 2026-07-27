# Browse and revise saved Ground Truth

Status: ready-for-agent
Type: interactive

## Parent

- `.scratch/actionable/dev-harness-review-surfaces/PRD.md`
- Blocks: issue 05 (the climb-window control moves onto this surface)

## What to build

Accepted Ground Truth is currently write-once from the operator's point of view:
the only way back in is the Calibrate flow, framed as *re-calibration* and
starting from the seed-tap screen. Turn it into a review surface that can be
walked across the corpus.

### The corpus row

`hasGroundTruth ? "Ground truth" : "Calibrate"`, replacing `"Re-calibrate"`. The
label change is the whole affordance: the button now means "look at what was
accepted", not "start over".

### Opening from disk

`components/dev/Calibrator.tsx` opens at `phase: "review"` when the Bundle has
accepted Ground Truth, hydrated from `ground-truth.json` with **no ViTPose job
fired**. The saved frames are the seed and `reconstructControlPoints(gt.frames)`
rebuilds the working flags — that function already exists for the
carry-forward path and is exactly the right primitive here.

Load `vitpose.json` opportunistically to restore context (non-core) joints,
which saved truth does not carry, and degrade to core-only when the artifact is
absent or stale. Context joints are display-only; they must never influence what
is saved.

A truthless Bundle still opens at `phase: "idle"` — the seed-tap screen —
exactly as today. `Back to seed` stays in the review: a Bundle whose truth
tracked the wrong person must remain re-tappable and re-seedable, and that
escape hatch is the reason the seed tap exists.

### Prev/next Bundle

Navigation across Bundles from inside the review, showing whichever screen fits
each one — the saved review where truth exists, the seeding screen where it does
not. `Calibrator` takes an ordered list plus an index rather than a bare item.

Freeze the list at open, following the pattern `ReseedSweeper` established:
badges flip as artifacts land, and a queue that reshuffles mid-pass is
unusable across ninety Bundles.

### Auto-save when dirty

Navigating with changed flags saves first, then advances. Dirty is a comparison
against what was loaded, so an untouched Bundle is never re-written and its
`groundTruthHash` never moves. `Accept & save` stays for an explicit commit, and
a save failure must block the advance and surface the reason rather than
silently discarding the edits.

## Design notes — the hash consequence

`review` is part of the Ground Truth hash pre-image
(`canonicalGroundTruthInput`), so a flag edit re-derives `groundTruthHash`.

That does **not** unpair runs: pairing is `setupHash`-only
(`runPairsWithTruth`). What it does mean is that every prior run's embedded
`scoring` block becomes evidence computed against a superseded reference, with
nothing in the UI currently saying so.

Surface it rather than hiding it. Issue 02's run picker already reports each
run's `groundTruthHash`; a run whose stamp differs from current truth reads as
`re-score`. Re-running Analyze is the existing remedy and needs no new
machinery — but the operator has to know the remedy is owed.

The ground-truth `PUT` already 409s a write whose `setupHash` is not the current
setup's, so a Bundle whose Setup moved cannot have flags edited into a stale
truth. Surface that 409 as the stale-truth state it is, not as a generic
failure.

## Acceptance criteria

- [ ] The corpus row reads `Ground truth` when truth is accepted and
      `Calibrate` when it is not.
- [ ] Opening an accepted Bundle shows the saved review with its flags intact
      and fires no ViTPose job.
- [ ] A truthless Bundle opens on the seeding screen.
- [ ] Prev/next walks the corpus in list order, showing the right screen per
      Bundle, over a queue frozen at open.
- [ ] Navigating with changed flags saves before advancing; navigating an
      untouched Bundle performs no write and leaves its `groundTruthHash`
      unchanged.
- [ ] A failed save blocks the advance and shows the reason.
- [ ] A Bundle whose truth is stale surfaces that state rather than a raw 409.
- [ ] `Back to seed` still reaches the seed-tap screen from the review.
- [ ] Context joints render when `vitpose.json` is available and their absence
      degrades cleanly; they never affect what is written.
- [ ] Semantic colour tokens only; dismiss seams use the shared hooks/Modal.
      No `any`.

## Tests

- Extend `__tests__/components/dev/` coverage for the Calibrator's review-from-
  disk entry, prev/next traversal across a mixed truthful/truthless list, the
  dirty check (no write when clean), and the blocked advance on save failure.
