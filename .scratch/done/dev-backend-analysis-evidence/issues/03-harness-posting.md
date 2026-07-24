# Harness posting with detector attempts

Status: done
Branch: feat/harness-posting-detector-attempts
Merged: 6c6483a
Type: AFK

## Parent

- `.scratch/done/dev-backend-analysis-evidence/PRD.md`

## What to build

Update dev Analyze payload construction so the detections relay posts the enhanced detector attempt stream as the backend analysis evidence. The scanner should continue to post diagnostics and ORB summary data, while backend interpretation remains owned by the external analysis service.

## Acceptance criteria

- [x] Posted pose payloads include `detectorAttempts` for the completed Analyze run.
- [x] The pose body remains append-only and includes `detectorAttempts` alongside the existing setup, app, and Ground Truth identifiers.
- [x] Dense interpolated/filled/smoothed/constrained playback frames are not exported as current detector evidence.
- [x] Backend-facing scoring prefers `data.detectorAttempts[]` when present and treats legacy `data.frames[]` as proxy evidence only.
- [x] Missing `detectorAttempts[]` is represented as an unknown detector-attempt stream, not inferred detector success.
- [x] Unit tests cover payload shape, omitted dense frames, and accepted/rejected/missing attempt preservation.
- [x] Compatibility tests cover older runs that only carry `data.frames[]`.

## Comments

- Do not add backend recommendation logic in beta-scanner.
- Keep the relay pass-through behavior unchanged except for the posted body shape.
- Keep `setup.json.analysisInputs` in the payload as advisory provenance metadata, not main scoring truth.

