# Analyzer Tuning-Suggestion Loop (Deferred)

Status: ready-for-agent
Disposition: parked

## Deferred Status

This PRD is intentionally parked. Do not start implementation work from this document until it is explicitly re-activated.

## Idea

Build an analyzer capability that consumes pose-detection tunable semantics and emits safe, explainable, reversible tuning suggestions:

- JSON Patch suggestion outputs with required inverse patches for one-step rollback.
- Preflight dry-run validation and whole-set dependency validation.
- At most one top-ranked suggestion per tunable per cycle.
- Confidence that starts heuristic and calibrates from logged outcomes after a minimum sample floor.
- Review-only default with optional guarded auto-apply.
- Append-only redacted outcome logging.

## Why Parked

This is a distinct product from the cross-program scanner/harness data-contract scope. The harness currently emits label suggestions (video-stats prefill), not tuning-knob suggestions. This work is deferred until concrete need and a dedicated design pass exist.

It must not ride along with contract reconciliation work tied to harness #63.

## Source Lineage

Derived from stories 13-31 of `.scratch/actionable/pose-pipeline-contract-authority/PRD.md` before reconciliation.
