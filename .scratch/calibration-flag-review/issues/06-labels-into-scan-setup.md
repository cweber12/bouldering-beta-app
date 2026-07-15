# Condition Labels into the Scan Setup

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/calibration-flag-review/PRD.md`

## What to build

Move the manual condition labels to where the harness now reads them — `setup.json.analysisInputs` — per the scanner data contract:

- The Scan Setup write becomes a **server-side merge**: a labels-only save preserves the existing crops/point/panning/tier (and their `setupHash`), and a crops-only save preserves the existing `analysisInputs` block. Inner label keys are snake_case (`route_orientation`, `camera_angle`, `shadows`, `climber_contrast`, `wall_contrast`, `motion_blur`, `occlusion`, `camera_stability`, `notes`); undecided values are `"unknown"`; `route_folder` is never included (structural, harness-owned).
- `setupHash` continues to cover only the scan-affecting inputs — never the labels — so a label edit can never orphan saved Ground Truth or prior runs.
- The metadata modal keeps its UI but persists through the setup write; the old label-write path into the downloader-owned `metadata.json` is retired.

## Acceptance criteria

- [ ] Labels persist into `setup.json.analysisInputs` with snake_case inner keys and survive a subsequent crops-only save.
- [ ] A labels-only save leaves the scan-affecting fields and `setupHash` byte-identical.
- [ ] Editing any label never changes `setupHash`.
- [ ] The metadata.json label-write path no longer exists; the modal round-trips through the setup route.
- [ ] Covered by tests, including a new route-level test for the setup merge (following the existing dev-route test pattern).

## Blocked by

None - can start immediately
