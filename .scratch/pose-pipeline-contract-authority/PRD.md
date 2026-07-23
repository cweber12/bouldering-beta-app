# Pose Pipeline Contract Authority for Analyzer Suggestions

Status: ready-for-agent

## Problem Statement

The prior scanner PRD over-scoped the cross-program contract by mixing data-contract obligations with a separate analyzer tuning product. In this local-only, one-maintainer workflow, scanner and harness must align on the thin contract overlap that already exists, using the harness contract probe as the mechanism of record.

## Reconciled Scope

Scanner participates in one cross-program contract with the analysis harness. Scanner obligations are only:

1. Probe + gate. Fetch `GET {HARNESS_API_BASE}/api/contract` once at startup, cache it, gate harness-facing features on `endpoints`, `artifacts`, `capabilities`, and `suggestions`, and degrade visibly when mismatched or unreachable (never silent 404 behavior).
2. Write bundle artifacts. Emit `setup.json.analysisInputs`, `ground-truth.json`, and detection diagnostics per scanner-data-contract.md.

## Mechanism of Record

The contract mechanism of record is the harness `GET /api/contract` endpoint. Scanner does not introduce a second contract system for this scope.

## Out of Scope

- Scanner-generated contract governance (source-derived schema generation, deterministic artifact pipeline, CI drift/compat gates, PR governance metadata, changelog deltas, and minimum-version bump policy).
- Additional runtime schema endpoints or committed generated contract artifacts served by scanner.
- Index-first pinned artifact discovery, checksum lane governance, alias lanes, and semver activation ceremony beyond harness `apiVersion` + per-artifact version map.
- Tunable lifecycle governance (replaced-by rules, exemptions, and deprecation policy automation).
- Artifact signing policy and trigger framework.
- Analyzer tuning-suggestion/calibration safety loop (JSON Patch + inverse patches, preflight and whole-set validation, confidence calibration, outcome logging, explainability scoring, and auto-apply controls).

## Deferred Companion

The analyzer tuning-suggestion loop is a separate deferred backlog concern and is tracked in `.scratch/analyzer-tuning-suggestion-loop/PRD.md`. It is not part of this cross-program data-contract reconciliation.

## References

- scanner-video-stats.md (work item 0: probe, gate, and visible degrade behavior)
- scanner-data-contract.md (bundle artifact contract; companion doc in the harness repository)

## Acceptance

- Contract obligations in this PRD are only the two reconciled scanner responsibilities above.
- The scanner PRD mirrors harness #63 scope boundaries for contract behavior.
- Analyzer tuning-suggestion work does not appear in this PRD and lives only in the deferred companion PRD.
- No scanner-side contract-generation, schema-artifact, or governance-program work is scheduled by this PRD.
