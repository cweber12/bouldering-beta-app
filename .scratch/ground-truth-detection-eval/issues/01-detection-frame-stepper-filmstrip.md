# Detection Frame Stepper and Filmstrip

Status: done
Branch: main
Merged: 8b061ed
Type: AFK

## Parent

- `.scratch/ground-truth-detection-eval/PRD.md`

## What to build

A reusable navigator over a video's **Detection Frames** in the dev harness Detection Preview: step to the previous/next Detection Frame, jump to the next flagged stretch, and a filmstrip of one tick per Detection Frame colored by detection status (detected / weak / missing / flip), with click-to-seek. It drives the existing `FramePlayer` through its imperative handle (`play/pause/seek`), pausing playback and snapping the video backdrop + skeleton to the chosen frame.

The frame list + statuses come from per-frame data the scan already produces: `utils/cropTrace.ts` entries (timestamp, detected, reacquired, refinement) and the sampled-frame status feeding `detectBadStretches` (`pipeline/analysis/diagnostics.ts`). Expose whatever `useVideoProcessor` does not already return so the component can consume a plain `{ timestamp, status }[]`. Build it as a standalone component (props: frame list, current index, `onSeek`, and an `onAnnotate` seam left unused for now) so the future landmark editor (issue 04) reuses it. Wire it into the harness preview (`app/dev/harness/page.tsx`, the `phase === "preview"` block) beside the existing `FramePlayer` + `DiagnosticsPanel`.

Keyboard: ←/→ step, space play/pause.

## Acceptance criteria

- [x] The harness Detection Preview shows a filmstrip with one tick per Detection Frame, colored by status, bad-stretches visibly highlighted.
- [x] Prev/next and click-to-seek move the player to the exact Detection Frame; ←/→ and space work.
- [x] "Jump to next flagged stretch" lands on the next missing/weak run.
- [x] The stepper is a self-contained component with no harness-specific coupling (reusable), covered by tests.
- [x] Continuous play still works; stepping pauses and snaps to frame.

> Shipped in 8b061ed. The stepper was wired into the harness Detection Preview
> as specified; that phase was later removed with the throwaway scan
> (`.scratch/calibration-analyze-split/issues/01`), and the component now drives
> the Ground Truth review and the Analyze step's rendered run instead. Reusable
> exactly as intended — the seam outlived the caller it was built for.

## Blocked by

None - can start immediately.
