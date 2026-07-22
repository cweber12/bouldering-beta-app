# Docs alignment — ADRs 0018/0019 and old issues 08/09

Status: done
Branch: chore/calibration-analyze-split-docs-closeout
Merged: a7b97ef
Type: AFK

## Parent

- `.scratch/calibration-analyze-split/PRD.md`

## What to build

Bring the documented decisions in line with the shipped ones. Amend ADR 0018 (grid definition → uniform 100 ms video-keyed grid; staleness rule → removed for accepted truth; scoring flow → probed-frame domain with `probeCoverage`) and ADR 0019 (seed timing → immediately on setup confirm; grid source → pure arithmetic, not a MediaPipe pass). Re-point the old ground-truth-detection-eval issues 08 (headless scoring) and 09 (batch gate) at this feature's issues 04 and 05 with a short note, so the tracker never double-tracks the Analyze work and the drift audit stays clean — their grilled scoring design remains referenced, not rewritten. Update CONTEXT.md glossary entries touched by the grid/keying change if any drifted.

## Acceptance criteria

- [x] ADR 0018 and ADR 0019 describe the uniform grid, video-keyed truth, and Analyze-step flow as built.
- [x] Old issues 08/09 carry a status + note pointing at this feature's issues 04/05; `node scripts/audit-issues.mjs` reports no drift.
- [x] CONTEXT.md matches the shipped vocabulary.

## Blocked by

- `.scratch/calibration-analyze-split/issues/01-uniform-grid-calibration.md`
- `.scratch/calibration-analyze-split/issues/02-video-keyed-ground-truth.md`
- `.scratch/calibration-analyze-split/issues/03-analyze-action-production-run.md`
- `.scratch/calibration-analyze-split/issues/04-scoring-vs-ground-truth.md`
- `.scratch/calibration-analyze-split/issues/05-batch-analyze-gt-gate.md`

## Comments

- 2026-07-17 (tracker audit): the second acceptance criterion is already
  satisfied — old issues 08/09 now carry `Status: wontfix` + `Superseded-by:`
  pointers at this feature's issues 04/05, and the drift audit is clean. The
  ADR 0018/0019 amendments and the CONTEXT.md check remain to be done here.
- 2026-07-18: the staleness direction reversed — ADR 0020 (calibration
  freshness, commit 65d35ba) reinstates hash-chained truth staleness as a
  surfaced state, superseding the "staleness rule → removed for accepted
  truth" wording above. When amending ADR 0018, describe staleness as
  "surfaced + re-seed, per ADR 0020", not removed. The CONTEXT.md Ground
  Truth entry was already updated in that commit; issue 06 is closed wontfix
  (the harness declined video-identity pairing).
- 2026-07-21: completed. ADR 0018/0019 now reflect the shipped calibration-
  analyze split (uniform arithmetic grid, Analyze-run scoring flow, and
  staleness surfaced via ADR 0020); CONTEXT vocabulary checked unchanged.
