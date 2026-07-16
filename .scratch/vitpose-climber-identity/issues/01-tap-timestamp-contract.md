# 01 — Carry the tap timestamp through Scan Setup and the ViTPose request

Status: ready-for-agent

## Context

`StepSetDetection` already has the tap's video time (`video.currentTime` at tap,
passed to `onClimberTapDetect`) but it is dropped before Scan Setup. Without it
the downloader cannot anchor Climber-seed selection to the tapped frame and
searches the whole clip (PRD problem 1).

## Scope (beta-scanner only)

- `utils/harnessSetup.ts`: `climberPoint` becomes `{ x, y, t? }` (`t` = video
  seconds, finite, ≥ 0, optional). `canonicalSetupInput` includes `t` (round6)
  **only when defined** so legacy setup hashes are unchanged.
  `parseScanSetupInput` validates the optional field.
- Tap capture: wherever `onClimberPointChange` fires from a tap
  (`StepSetDetection`, both inline and fullscreen video), the stored point
  carries the current video time. Scan page and harness page state both hold the
  extended point; re-tap replaces `t`.
- `utils/harnessViTPose.ts` `ViTPoseRequest.climberPoint` gains `t?`; the dev
  proxy (`app/api/dev/corpus/vitpose/route.ts`) passes `climber_point` through
  including `t`.
- Contract doc: `downloader-selector-fix.md` in this feature dir documents the
  `climber_point.t` field for the downloader side.

## Acceptance

- `npx tsc --noEmit`, `npx eslint .` clean.
- `harnessSetup` tests: hash unchanged for a point without `t`; hash changes
  when `t` is added; parser accepts `{x,y}`, `{x,y,t}`, rejects non-finite `t`.
- Calibrating in `/dev/harness` after a tap saves `setup.json` with
  `climberPoint.t` and the ViTPose POST body carries it.
