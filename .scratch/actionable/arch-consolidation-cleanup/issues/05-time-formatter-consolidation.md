# Consolidate the five playback-time formatters

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-consolidation-cleanup/PRD.md`

## Blocked by

Nothing. Independent of every other issue in this PRD.

## What to build

Five implementations of "format a number of seconds for a transport bar", producing **three
different results**:

| Site                                                   | Name              | Output   | Guard                   |
| ------------------------------------------------------ | ----------------- | -------- | ----------------------- |
| `components/dev/DetectionFrameStepper.tsx:122`         | `formatTime`      | `m:ss`   | finite-guarded          |
| `components/dev/RunReviewer.tsx:111`                   | `formatTime`      | `m:ss.s` | finite-guarded          |
| `components/skeleton/FramePlayer.tsx:211`              | `formatTime`      | `m:ss`   | **no finite guard**     |
| `components/scan/process-flow/StepSetDetection.tsx:24` | `formatVideoTime` | `m:ss`   | —                       |
| `components/dev/SeedTapEditor.tsx:23`                  | `formatVideoTime` | `m:ss`   | identical body to above |

Build one `formatPlaybackTime(seconds, options)` in `utils/`, taking the decimal precision as an
option so both `m:ss` and `m:ss.s` are reachable. Per the divergent-duplicate rule, each call site
passes what reproduces its current output exactly — `RunReviewer` keeps one decimal, the other
four keep zero.

Include the finite guard unconditionally. `FramePlayer.tsx` lacking it is the one place where
consolidation should _fix_ rather than preserve: a non-finite `duration` there renders `NaN:NaN`
in the transport bar, and the other four already guard against it. Note this in `## Comments` as
a deliberate exception to variant-preservation — it removes a defect rather than changing intended
output.

There is an existing `utils/formatRunTimestamp.ts`, but it formats Run timestamps (wall-clock
dates), not playback seconds. Leave it alone; the new function is a sibling, not a replacement.
Name the new one distinctly enough that the two are not confused at an import site.

## Acceptance criteria

- [ ] One `formatPlaybackTime` function exists in `utils/`, with the precision as an option.
- [ ] A characterization test covers, for each precision: zero, sub-minute, exact-minute,
      multi-minute, and hour-plus durations; plus `NaN`, `Infinity`, and negative input.
- [ ] The test asserts the current output of all five existing implementations before any call
      site migrates.
- [ ] `RunReviewer` still renders `m:ss.s`; the other four still render `m:ss`.
- [ ] `FramePlayer` no longer renders `NaN:NaN` for a non-finite duration, and that change is
      recorded in `## Comments` as intentional.
- [ ] All five local implementations are deleted; no `formatTime` or `formatVideoTime` remains in
      `components/`.
- [ ] `utils/formatRunTimestamp.ts` is untouched.
- [ ] `npx tsc --noEmit`, `npx eslint .`, and **full** `npx vitest run` pass.

## Comments

- Three of the five call sites (`FramePlayer`, `StepSetDetection`, `SeedTapEditor`) sit in files
  with no direct test coverage of their formatting, which is why the characterization test has to
  pin the current output before anything moves rather than relying on the existing suite.
