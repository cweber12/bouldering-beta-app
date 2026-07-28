# Stamp the scaffold seedHash into Ground Truth, and read staleness off it

Status: done
Branch: feat/adr0007-04-truth-scaffold-provenance
Merged: e0701f1
Type: AFK

## Parent

- `.scratch/actionable/harness-contract-adr0007-adoption/PRD.md`
- Spec: `beta-scan-analysis/docs/handoffs/scanner-truth-scaffold-provenance.md`
- Extends: `beta-scan-analysis/docs/handoffs/scanner-calibration-freshness.md`
  (the `setupHash` staleness rules, landed as `.scratch/done/pose-calibration-freshness/`)
- Harness refs: their issue #119, the `scaffold_truth_drift` detector (PR #118),
  ADR 0007
- Independent of issues 01–03; can land in any order

## What to build

Ground Truth is authored *from* a ViTPose scaffold and records nothing about
**which** scaffold. Regenerate the scaffold — a re-seed, a detector-resolution
change — and the truth on disk keeps describing the superseded one, with nothing
on either side able to tell. Every frame the new scaffold poses that the old
truth calls absent becomes a **phantom absence**: it lands in the truth-absent
population and is scored as a scanner hallucination.

This is structurally the same blind spot ADR 0007 closed one layer down. There,
`setupHash` matched whether or not a re-seed had moved the tap, so a stale
scaffold was undetectable; `seedHash` fixed it. The identical hole sits between
scaffold and truth — `setupHash` tracks *calibration*, and **re-seeding does not
change the calibration**, so both of our signals read healthy:

- `hasGroundTruth` is file existence ("`ground-truth.json` is only ever written
  by Accept & save, so existence is acceptance").
- `truthStale` is true only when the truth stamps an **older `setupHash`** than
  `setup.json`.

The harness measured **11 bundles adrift** after the #101 corpus reset — two of
them (`w420jGWP2W0`, `VxhW7T4vg7E`) recording **zero** present frames against
fully-posed scaffolds, and both showing as accepted and healthy in our dev
corpus UI.

1. **Parse `seedHash` off the scaffold.** `vitpose.json` now carries the ADR 0007
   `seedHash` (seed tap + seed region + climb window + video binary).
   `ViTPoseScaffold` / `parseViTPoseScaffold` drop it today; carry it through the
   same way `setupHash` already is.

2. **Stamp it into Ground Truth at Accept & save.** Write the scaffold's
   `seedHash` verbatim into `ground-truth.json` as `scaffoldSeedHash`, taken from
   the scaffold the review was actually seeded from — not re-read from disk at
   write time, which would stamp whatever scaffold happens to be current and mask
   the very drift this detects. A scaffold with no `seedHash` (written before
   ADR 0007) means there is nothing to stamp: **omit the field**, never invent one.

3. **Extend `truthStale` with the scaffold axis**, null-guarded on both sides:

   ```text
   truthStale = truthSetupHash !== setupHash
             || (truthScaffoldSeedHash != null
                 && scaffoldSeedHash != null
                 && truthScaffoldSeedHash !== scaffoldSeedHash)
   ```

   Truth written before this change carries no stamp and must degrade to today's
   behaviour — **not** to "stale". Fail-open is the established tradition on both
   sides of this contract; a missing stamp is *unknown* provenance, never a
   failure.

4. **Make the Calibrator agree.** It recomputes `truthStale` locally from its own
   loads, so a scaffold-drifted bundle would open showing "accepted, paired to
   the current Setup" with no Review seed shortcut — badged stale in the corpus
   row and unfixable in the act it links to. Its seed probe must run for the
   scaffold axis too, and re-accepting in-session must clear the state.

5. **A heuristic fallback for unstamped truth.** *(Added after the first landing
   — see Comments.)* The stamp only helps truth written from now on, so on the
   corpus as it stands **every** bundle fails open and the 11 adrift ones stay
   invisible. Mirror the harness's `scaffold_truth_drift` inference (PR #118) —
   present-frame shortfall ≥20 **and** truth under half the posed count — as a
   **separate** corpus signal from `truthStale`, since it is a guess rather than
   a proof. Silent the moment both sides carry a stamp, so re-accepting a bundle
   retires the guess for it permanently.

## Acceptance criteria

- [x] `parseViTPoseScaffold` carries a non-empty `seedHash` through and omits it
      otherwise, rejecting a non-string exactly as it does `setupHash`.
- [x] Accept & save writes `scaffoldSeedHash` into `ground-truth.json` when the
      seeding scaffold carried a `seedHash`, and omits the field when it did not.
- [x] `groundTruthHash` is unchanged for truth without the stamp — the field is
      provenance about the reference, not part of the reference being scored, so
      it stays out of the canonical pre-image and no existing hash moves.
- [x] The corpus listing reports `truthStale` for a bundle whose truth stamps a
      different `scaffoldSeedHash` than the scaffold on disk, with the
      calibration hash matching.
- [x] A truth with no `scaffoldSeedHash`, or a scaffold with no `seedHash`, reads
      exactly as today — pinned by a test that fails if either degrades to stale.
- [x] Opening Calibrate on a scaffold-drifted bundle shows the stale banner and
      offers Review seed; re-accepting clears both without a corpus refetch.
- [x] Badge and banner wording names both axes — an accepted badge must not read
      as healthy when the scaffold has moved, exactly as it must not when the
      calibration has.
- [x] The heuristic fallback surfaces the adrift bundles as their own state,
      stays out of `truthStale`, does not fire on ordinary human flagging, and
      goes silent for a bundle once an exact hash comparison is available.
- [x] Run against the real corpus, the fallback reports exactly the 11 bundles
      the harness measured — no more, no fewer.

## Comments

- Field name is the harness's suggestion, not a requirement. It reads
  `scaffoldSeedHash` off the truth and prefers the exact hash comparison, keeping
  its `scaffold_truth_drift` heuristic (≥20-frame shortfall *and* truth under half
  the posed count) only as the fallback for unstamped truth.
- **No write-time gate.** The `setupHash` PUT gate 409s a truth seeded from an
  older calibration; the seed axis deliberately gets no equivalent. The 11 adrift
  bundles went adrift because their scaffolds were regenerated *after* acceptance
  — a write-time gate could not have caught any of them, and refusing the write
  would only block re-authoring. Make it visible; do not remove the human from
  acceptance.
- Nothing is auto-accepted and this does not change that (`ReseedSweeper` states
  the design and it stands).
- Re-accepting the 11 adrift bundles is corpus work under harness #101, not this
  issue.
- Overlaps issue 03 only at the artifact parse: 03 handles the `seedHash` on the
  POST **response** (`200 skipped`), this one the `seedHash` on the **artifact**.
  Whichever lands second inherits the parsed field.

- **Why §5 was added.** The stamp landed and every bundle still read `accepted`.
  That was correct — all 89 scaffolds carry a `seedHash`, **zero** truths carried
  a `scaffoldSeedHash`, so every one fails open — but it made the change inert
  against the corpus that motivated it, and circular: the 11 adrift bundles would
  stay invisible until re-accepted, with nothing saying which to re-accept. The
  handoff said the harness keeps its heuristic as the fallback for unstamped
  truth; we had never built the scanner-side equivalent, so our UI could not
  point at them. Run over the real corpus the fallback returns exactly the
  harness's 11, matching the handoff table frame-for-frame
  (`fKjfXtqLA1I` 190/1811, `w420jGWP2W0` 0/1235, `The_Mandala` 68/600,
  `VxhW7T4vg7E` 0/463).

## Implementation notes

- The two axes are composed once, in `utils/harnessFreshness.ts`
  `truthStaleAxis()`, rather than OR-ed at each call site. The corpus lister
  reads it as a boolean; the Calibrator words its banner off the axis. When both
  have moved it returns `calibration`, because re-calibrating re-seeds as part of
  itself and naming the scaffold would send the operator after the smaller of two
  problems.
- **The Calibrator's probe gate had to widen.** It recomputes staleness from its
  own loads, but the scaffold axis cannot be evaluated until the probe has
  fetched the scaffold — gating the probe on the answer it produces is circular.
  The corpus row's `item.truthStale` therefore opens the probe, and the probed
  scaffold then decides. Without this, a bundle badged `stale · seed ready` would
  open showing "accepted, paired to the current Setup" with no Review seed
  button: flagged in the corpus and unfixable in the act it links to.
- The Calibrator has no component test in this repo, so the criterion above is
  covered by the extracted-seam route the repo already uses for calibrator logic:
  `truthStaleAxis` unit tests alongside the existing `reseedAffordanceDecision`
  ones. Manual dev-server confirmation still wants a genuinely drifted bundle.
- `readTruthStamps` replaces the second `ground-truth.json` read in `listCorpus`:
  the file runs to 100k frames and both axes now need a stamp off it, so they
  share one parse instead of two.
- CONTEXT.md's **Ground Truth** entry is updated in the same commit — "stale" now
  means two different things and the glossary said only one of them.
- The heuristic is a **transitional** signal and is written to retire itself:
  `truthScaffoldLikelyDrifted` returns false the moment both sides carry a stamp,
  so each re-accept removes one bundle from its reach and the corpus reset
  removes all of them. It is scoped to bundles not already `truthStale` — a
  proven signal needs no weaker second opinion about the same thing.
- Drifted bundles are deliberately **not** added to the re-seed sweep queue.
  Their scaffolds are already fresh; what they need is re-accepting, and queuing
  them would burn GPU re-posing scaffolds that are fine.
