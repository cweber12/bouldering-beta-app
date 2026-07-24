# Docs Alignment: ADR Amendments and Drift Audit

Status: done
Branch: docs/cfr-07-docs-alignment
Merged: 684eb81
Type: AFK

## Parent

- `.scratch/done/pose-calibration-flag-review/PRD.md`

## What to build

Bring the documented authoring model in line with the shipped one:

- Amend ADR 0018 (authoring sections) and ADR 0019 to describe flag-only review: auto-accepted seeds, the three-way flag vocabulary and its state mapping, `verified` as "nobody objected", the ViTPose hard requirement (no MediaPipe seed fallback), and the `review` / `setupHash` provenance fields with the staleness rule.
- Update the CONTEXT.md glossary entries touched by the change (Ground Truth, and any entry describing landmark correction or the calibration pass).
- Update the agent-rules docs if they still describe removed interactions (dragging, occlusion toggling, per-frame accept).
- Run the issue drift audit and resolve anything it reports for this PRD's issues.

## Acceptance criteria

- [ ] ADR 0018 and ADR 0019 describe the flag-only model, the ViTPose requirement, and the provenance fields; no doc still describes dragging as the authoring mechanism.
- [ ] CONTEXT.md glossary matches the shipped semantics.
- [ ] The drift audit reports no implemented-but-not-closed or closed-but-unmerged issues for this feature.

## Blocked by

- `.scratch/done/pose-calibration-flag-review/issues/01-gt-provenance-schema.md`
- `.scratch/done/pose-calibration-flag-review/issues/02-auto-accept-scaffold-helpers.md`
- `.scratch/done/pose-calibration-flag-review/issues/03-readonly-reviewer-accept.md`
- `.scratch/done/pose-calibration-flag-review/issues/04-vitpose-hard-requirement.md`
- `.scratch/done/pose-calibration-flag-review/issues/05-review-affordances.md`
- `.scratch/done/pose-calibration-flag-review/issues/06-labels-into-scan-setup.md`
