# Docs and glossary alignment

Status: in-progress
Branch: chore/docs-glossary-evidence
Type: AFK

## Parent

- `.scratch/actionable/dev-backend-analysis-evidence/PRD.md`

## What to build

Update project documentation so future agents understand the distinction between detector evidence and continuity/playback output. Add or amend glossary language only where it clarifies stable domain terms.

## Acceptance criteria

- [ ] CONTEXT.md defines **Detector Attempt** if the implementation introduces that term in exported contracts.
- [ ] Existing **Detection Frame**, **Interpolated Landmark**, and **Estimated Landmark** glossary entries remain consistent with the new evidence stream.
- [ ] Relevant scratch issue comments or docs note that this enhances backend analysis inputs without moving recommendation semantics into beta-scanner.
- [ ] Docs state that `setup.json.analysisInputs` are advisory metadata and Ground Truth remains authoritative for expected Climber presence and pose.
- [ ] Docs state that older `frames[]`-only payloads are legacy/proxy evidence and a missing `detectorAttempts[]` stream is unknown, not detector success.
- [ ] Tests and issue drift audit pass after the implementation issues land.

## Comments

- No ADR is required unless the implementation makes a hard-to-reverse payload compatibility decision that would surprise future readers.
- This documentation pass clarifies backend analysis inputs only. beta-scanner exports detector evidence and advisory setup metadata; recommendation semantics stay owned by the external backend analysis service.

