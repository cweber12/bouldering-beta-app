# Split poseInterpolator.ts per algorithm

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-consolidation-cleanup/PRD.md`
- Rules: `pipeline/CLAUDE.md`
- Related: `docs/adr/0015-rigid-body-bone-constraint.md`,
  `docs/adr/0004-motion-adaptive-pose-quality-pipeline.md`

## Blocked by

Nothing. Independent of every other issue in this PRD.

## What to build

`pipeline/pose/poseInterpolator.ts` is 1,004 lines holding five independent algorithms, each with
its own private helpers and tuning constants:

- `filterLandmarks` — confidence filtering
- `interpolatePoseFrames` — Catmull-Rom interpolation across sparse frames
- `estimateMissingLandmarks` and `fillPersistentGaps` — gap filling
- `smoothPoseFrames` — One-Euro smoothing
- `constrainSkeleton` — bone-length and angle constraints (ADR 0015)

Split into one module per algorithm under `pipeline/pose/`, each carrying its own tuning constants
and private helpers. Shared helpers used by more than one algorithm go into a module all of them
may import — do not duplicate them, and do not leave them behind in whichever module happens to
sort first.

A pure split: no function changes name, signature, or body, and the pipeline execution chain
documented in `pipeline/CLAUDE.md` is unchanged —

```text
estimateFramesMediaPipe() → interpolatePoseFrames() → smoothPoseFrames() → buildSkeletonFrameData()
```

Update `pipeline/CLAUDE.md`'s module map to list the new `pose/` modules. Prefer updating call
sites over leaving a re-export barrel, for the same reason as issue 07.

Every new module must satisfy `pipeline/CLAUDE.md`: zero React imports, no `async`, `cv` threaded
explicitly where used.

Split `__tests__/pipeline/poseInterpolator.test.ts` to follow the new modules, preserving every
assertion.

## Acceptance criteria

- [ ] Each of the five algorithms lives in its own module under `pipeline/pose/`.
- [ ] Each module carries the tuning constants and private helpers only it uses; helpers shared by
      several live in one module all of them import, not duplicated.
- [ ] No function changed name, signature, or body — the diff is moves and import lines only.
- [ ] The documented execution chain is unchanged, and `pipeline/CLAUDE.md`'s module map lists the
      new modules.
- [ ] No re-export barrel is left behind.
- [ ] Every new module has zero React imports and complies with `pipeline/CLAUDE.md`.
- [ ] Tests are split to match, with every existing assertion preserved and the total count
      unchanged.
- [ ] `npx tsc --noEmit` passes with zero output.
- [ ] `npx eslint .` passes, including the boundary and filename rules from the foundation PRD.
- [ ] **Full** `npx vitest run` passes with the same total test count as before.

## Comments

- There is one `eslint-disable @typescript-eslint/no-unused-vars` at line 963 of the current file.
  Resolve it during the split rather than carrying it into a new module — in a 1,000-line file it
  is easy to miss what it is suppressing, which is precisely the problem the split addresses.
- `constrainSkeleton` implements ADR 0015 and `smoothPoseFrames` sits inside the ADR 0004 quality
  pipeline. Neither ADR needs amending — the algorithms are unchanged and only their file homes
  move — but check both before finalising module names so the naming stays glossary-aligned.
