# 07 — Docs: amend ADR 0019 and CONTEXT.md for Climber Identity changes

Status: needs-triage
Gated on: lands with or after the phase it documents

## Scope

- ADR 0019: amend with the tap-timestamp contract field, the seed
  anchoring/gating/slack rules (Phase A), the appearance-anchored stitching +
  `seedDebug.stitch` sidecar diagnostics (downloader issue #19 — shipped
  2026-07, artifact still `version: 1`), and — once shipped — artifact v2
  candidates + swap/propagation semantics (Phase B).
- CONTEXT.md: update the Climber Identity / Scan Setup glossary entries for
  `climberPoint.t` and (Phase B) candidate swap.
- Mark the superseded parts of
  `.scratch/actionable/pose-ground-truth-detection-eval/downloader-vitpose-contract.md` with a
  pointer to this feature's docs.

## Acceptance

- Docs match shipped behaviour; no contract field exists undocumented.
