# Analyze action — production detection run, rendered

Status: ready-for-agent
Branch: feat/analyze-action-production-run
Type: AFK

## Parent

- `.scratch/calibration-analyze-split/PRD.md`

## What to build

A per-video **Analyze** action in the harness that runs the production MediaPipe pipeline exactly as the user-facing scan does — current implementation, current Scan Setup (crops, tap, tier, panning) — and renders the result: skeleton over the video with its `ScanDiagnostics`, restoring the eyeball view issue 01 deleted from calibration, now in the place it belongs. The run posts append-only through the existing detections relay, stamped `appVersion` + `setupHash` (the `groundTruthHash` stamp and scoring block arrive in issue 04). Analyze never fires automatically after Ground Truth accept — it is a deliberate, separate act.

## Acceptance criteria

- [ ] Analyze runs the same scan path the user-facing flow uses (sampling, refinement, adaptive crop) — no harness-only detection variant.
- [ ] The run's detection frames are all 100 ms multiples (alignment-by-arithmetic holds against the stored grid).
- [ ] Detection output renders with skeleton + diagnostics in the harness after the run.
- [ ] The posted run is append-only and stamped with `appVersion` and `setupHash`.
- [ ] Nothing auto-fires on Ground Truth accept.
- [ ] Type-check, lint, and targeted tests pass.

## Blocked by

- `.scratch/calibration-analyze-split/issues/01-uniform-grid-calibration.md`
