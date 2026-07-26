# Docs, glossary, and handoff reply

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/pose-detection-loss-recovery/PRD.md`

## What to build

Close the PRD by recording what shipped and answering the harness with what the
scanner learned. Runs last, after issues 01–06 are merged, so it describes shipped
behavior rather than intent.

1. **Glossary** (`CONTEXT.md`). Add or extend the terms this PRD introduced:
   - **Track Reset** — clearing the frozen **Adaptive Crop** after a run of
     misses so acquisition falls back to the **Climber Crop** seed.
   - **Reacquire Ladder** — the ordered tight-first search walked on a miss:
     rungs seeded at the last confident box and widened outward, full frame
     demoted to a last-resort final rung, stopping at the first rung that finds
     the Climber (inverted per the round-2 decision read — describe the shape
     issue 03 actually shipped).
   - **Re-latch Bar** — the score plus size/position consistency test a candidate
     must clear to resume a stale track.
   - Extend **Landmark Flip** with the re-anchoring behavior, and **Detector
     Attempt** with the new evidence fields.

2. **ADR cross-links.** Confirm ADR 0023 (flip gate re-anchoring, issue 02) and
   ADR 0024 (loss recovery: reset, ladder, gate ageing, re-latch bar; issues
   03–04) exist, are internally consistent, and are referenced from the modules
   they govern. Cross-reference ADR 0013 (predictive tap-seeded Adaptive Crop)
   and ADR 0014 (limb-aware reach disks), whose acquisition behavior these build
   on.

3. **Handoff reply** to `beta-scan-analysis` covering:
   - **The crop freezes, it does not drift.** `lastClimberBox` and the centroid
     history only advance on acceptance, so a lost track re-searches an identical
     rectangle indefinitely. This is the mechanism behind IoU 0.000 and the
     1,564-frame miss run.
   - **The corpus can already split the miss classes.** A `missing` attempt with
     `candidateCount > 0` was gated out by the identity gate, not undetected. The
     harness can re-slice the existing 2026-07-24 corpus on that today, before
     any new batch lands, and shrink `unexplained` without waiting for us.
   - **Full-frame reacquire always searched every pixel.** The unexplained misses
     are not "we never looked there" — they are `REACQUIRE_GATE` (0.35) applied
     to a prediction that stopped updating. Crop placement and detector weakness
     are not the only two hypotheses; gate ageing is a third.
   - **The sustained-evidence flip rule was declined**, and why (issue 02) —
     it would re-admit the single-frame glitch the module exists to remove. The
     cap plus re-anchor targets the same metric from the other end.
   - **Histogram equalization must not be used** on the detection crop. Grayscale
     plus `equalizeHist` blinded MediaPipe's RGB-trained model and produced zero
     detections on flagged frames; issue 05 ships a colour-preserving correction
     instead.
   - **`qualityRejected` is wired in and correct** — `filterLandmarks` is a real
     frame-level gate whose default budget is loose against MediaPipe's
     visibility scores. Retuning it is a separate measured change, not a bug fix.
   - **Contract proposal: `nearestCandidateDistance`** on missing attempts — the
     distance from the aged prediction to the nearest candidate centroid. The
     contract defers `selectionDistance`, so this is asked rather than shipped;
     it is the single most useful number for tuning the gate that issue 03
     introduces.

4. **README.** Only if a user-visible behavior description changed; detection
   internals do not belong there.

## Acceptance criteria

- [ ] `CONTEXT.md` carries the new terms with `_Avoid_:` lines in the existing
      style, and the extended **Landmark Flip** / **Detector Attempt** entries.
- [ ] ADR 0023 and ADR 0024 exist, agree with the shipped code, and are
      referenced from `flipDetection.ts` and `climberTracker.ts`.
- [ ] A handoff reply document is written for `beta-scan-analysis` covering all
      seven points above.
- [ ] Every issue 01–06 is `done` or `wontfix`, and the PRD `Status:` moves to
      `done` in the same commit as the last one.
- [ ] `node scripts/audit-issues.mjs` is clean from `main`.
- [ ] `.scratch/ROADMAP.md` is updated to move this PRD to the Done lane, and the
      PRD folder is moved to `.scratch/done/` with its `Disposition:` updated in
      the same commit.

## Comments

- The handoff reply is the deliverable that closes the loop: the harness owns the
  metrics and cannot see the mechanisms, so several of its inferences are
  correctable only from this side. Write it as findings, not as a status report.
- **An interim reply was sent early**, after issue 01 merged (`0cd9ce0`):
  `beta-scan-analysis/docs/handoffs/scanner-detection-improvements-reply.md`. It
  covers only what is true today — the shipped evidence fields, the `missReason`
  contract proposal, the `candidateCount > 0` re-slice the harness can run
  against the existing corpus without a new batch, the frozen-crop and
  full-frame-reacquire mechanisms, and the `reacquireSteps` scope flag. It went
  early because the backend's miss-cause classifier gates issue 01's target
  metric: `unexplained` cannot fall on a fresh batch until the harness reads
  `missReason`, and that field is not in its contract.
- The closing reply therefore covers only points 4, 5, 6, and 7 of the list above
  (flip rule declined, no histogram equalization, `qualityRejected` is wired,
  `nearestCandidateDistance` proposal) plus the shipped behavior of 02–06. Do not
  restate points 1–3; the interim reply already carries them. The
  `nearestCandidateDistance` ask was flagged there for lead time but deliberately
  left informal — the formal ask belongs with issue 03's shipped gate semantics.
- The interim reply is now tracked in `beta-scan-analysis` (confirmed in the
  round-2 handoff §5). The round-2 handoff itself
  (`scanner-detection-improvements-round-2.md`) supersedes parts of the interim
  reply's framing — the closing reply must acknowledge the batch-identity
  correction (never read `c305954` as 01-only) and answer the decision read
  with what 03 actually shipped.
