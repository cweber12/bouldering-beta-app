# Harness posting with detector attempts

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/backend-analysis-evidence/PRD.md`

## What to build

Update dev Analyze payload construction so the detections relay posts the enhanced detector attempt stream as the backend analysis evidence. The scanner should continue to post diagnostics and ORB summary data, while backend interpretation remains owned by the external analysis service.

## Acceptance criteria

- [ ] Posted pose payloads include `detectorAttempts` for the completed Analyze run.
- [ ] Dense interpolated/filled/smoothed/constrained playback frames are not exported as current detector evidence.
- [ ] Existing scoring continues to consume detector evidence only.
- [ ] The payload remains append-only and stamped with the existing setup, app, and Ground Truth identifiers.
- [ ] Unit tests cover payload shape, omitted dense frames, and accepted/rejected/missing attempt preservation.

## Comments

- Do not add backend recommendation logic in beta-scanner.
- Keep the relay pass-through behavior unchanged except for the posted body shape.

