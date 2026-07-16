# Uniform grid seeds calibration — MediaPipe scan removed

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/calibration-analyze-split/PRD.md`

## What to build

Calibration stops running detection. A new pure, framework-agnostic grid module computes the Detection Frame grid as `i × 100 ms` for `i = 0 … floor(duration / 100 ms)` from the video's duration — video-keyed, independent of setup, tier, and detector. On Confirm, the calibrator saves the Scan Setup and immediately requests the ViTPose job with that grid as the `frames` list (contract unchanged: echo-and-match within 1 ms), showing a loading state until `vitpose.json` lands, then enters the existing flag-only review. The throwaway MediaPipe pass, its pose-model loading, and the Detection Preview phase are deleted from the calibrator rather than disabled. Tier stays in the Scan Setup (and `setupHash`) as a parameter for future Analyze runs. ViTPose stays a hard requirement for authoring: on failure, review is gated with the existing message + retry while the setup save stands. Legacy-tap and seed warnings keep surfacing in the new flow.

Note: this slice removes the harness's only detection view; issue 03 restores it as the Analyze action.

## Acceptance criteria

- [ ] Grid module returns 100 ms-multiple timestamps covering the whole duration, deterministic, covered by unit tests (boundary at the final frame included).
- [ ] Confirm saves the setup and fires the ViTPose request with the uniform grid — no detection runs first; `vitpose.json` timestamps echo the grid.
- [ ] The calibrator loads no pose model; throwaway-scan wiring and Detection Preview phases are deleted, not flagged off.
- [ ] Loading state shows while polling; flag-only review opens on the seeded grid exactly as before.
- [ ] ViTPose failure gates review with retry; the setup save still succeeds; legacy-tap warnings still surface.
- [ ] Type-check, lint, and targeted tests pass.

## Blocked by

None - can start immediately.
