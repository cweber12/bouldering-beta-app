# Editable Video Metadata (analysis_inputs)

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/ground-truth-detection-eval/PRD.md`

## What to build

Let calibration edit the video-level `analysis_inputs` labels and write them back with a **field-level strict merge** into the downloader-owned `metadata.json`. A dev-proxy route reads `metadata.json`, overwrites only the changed `analysis_inputs.<field>` values, and preserves every other key verbatim (including `route_folder` / `imported_from`, which the downloader owns). A metadata editor panel in the harness calibration view renders the amount fields (`shadows`, `climber_contrast`, `wall_contrast`, `motion_blur`, `occlusion`) as `unknown / none / low / medium / high` selects; `camera_stability`, `route_orientation`, `camera_angle` as selects seeded with the current value plus a free-text escape; and `notes` as a textarea. An existing off-scale value is always kept as a selectable option so nothing is silently dropped. The currently-unused `analysisInputs` passthrough (`app/api/dev/shared.ts` `CorpusItem`) supplies the initial values.

Implements ADR 0018 §4 (beta-scanner mutates the downloader's `metadata.json`).

## Acceptance criteria

- [ ] Editing a label in calibration persists to `metadata.json` and reloads.
- [ ] The write preserves all non-`analysis_inputs` keys and all unedited fields (verified by a merge test).
- [ ] Amount fields use the ordinal scale; off-scale existing values are retained, not dropped.
- [ ] Non-dev requests are rejected; the route is `NODE_ENV`-gated.

## Blocked by

None - can start immediately.
