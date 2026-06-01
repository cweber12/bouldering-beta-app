# Fast / Balanced / Accurate Quality Tier Selector (S5)

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/pipeline-audit-upload-scan-view-save/PRD.md` (Addendum: Pose Detection & Climber Tracking)

## What to build

Replace the loose "lite/full/heavy model + frameStep slider" advanced controls in
`components/scan/process-flow/StepSetDetection.tsx` with a single user-facing
**Fast / Balanced / Accurate** quality tier. Each tier maps to a config bundle:

- model variant (`usePoseModel` lite/full/heavy)
- `maxPoses` (tracker candidate count)
- detection effort (gap-recovery / widen-on-loss aggressiveness)
- default `frameStep`

Define the presets in a shared module (e.g. extend `pipeline/climberTracker.ts`'s
tier types or a new `utils/poseTiers.ts`) so detection and UI read one source of
truth. Keep the advanced panel available to override individual knobs for power
users. Tier choice should flow through the scan page into `useVideoProcessor`.

## Acceptance criteria

- [ ] A single Fast / Balanced / Accurate control replaces the primary model +
      stride controls; advanced overrides remain accessible.
- [ ] Each preset maps to a documented config bundle (variant, maxPoses, effort,
      frameStep) from one shared source.
- [ ] Selecting a tier changes the model config and detection behavior end to end.
- [ ] Tests assert each preset resolves to the expected config.
- [ ] tsc, eslint, and vitest are green; README detection-controls section updated.

## Blocked by

None — can start immediately. Pairs naturally with issue 09 (tier-aware filtering).
