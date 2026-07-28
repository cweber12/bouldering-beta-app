# Close the residual utils/ leaf violations

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-conventions-and-enforcement/PRD.md`
- Decision: `docs/adr/0025-mechanically-enforced-layer-boundaries.md` (issue 01)

## Blocked by

Issue 03 — the harness extraction removes 6 of the 10 inversions; this issue closes what is left.

## What to build

After issue 03, five files stand between `utils/` and strict leaf status. Relocate each so that
`utils/` imports nothing from `pipeline/`, `hooks/`, `components/`, or `app/`. Pure moves; no
logic changes.

**`utils/backdropLuma.ts`** — the only _runtime_ `utils/ → pipeline/` edge in the repo. Line 14
imports `computeLumaStats` and the `LumaStats` type from `pipeline/overlay/contrastAdapter`. Move
the file into `pipeline/overlay/`; it is overlay-analysis code that reads frame pixels, and it
sits naturally beside the module it already depends on.

**`utils/cropTrace.ts`** — imports the `CropBox` type from `pipeline/tracking/cropDetector`. Move
into `pipeline/tracking/`.

**`utils/shipDiagnostics.ts`** — imports the `ScanDiagnostics` and `MatchDiagnostics` types from
`pipeline/analysis/diagnostics`. Move into `pipeline/analysis/`. Check before moving that it holds
no DOM or network calls that would make it unsuitable for the pipeline layer; if it does, split
the payload-shaping half into `pipeline/analysis/` and leave the transport half in a layer that
may perform I/O.

**`utils/poseTiers.ts`** — line 15 imports the `MediaPipeVariant` type from `hooks/usePoseModel`,
a util depending on a React hook module. Relocate the type itself rather than the file: it is a
pose-backend descriptor, so it belongs with the other pose types. Move `MediaPipeVariant` to
`pipeline/pose/poseDetection.ts` and have both `hooks/usePoseModel.ts` and the tier module import
it from there. `poseTiers.ts` then depends only on a pipeline type, which still violates the leaf
rule — so move `poseTiers.ts` into `pipeline/pose/` as well.

**`utils/mediaContainerStyle.ts`** — line 1 imports React's `CSSProperties` type. Decide and
record which of the two applies:

- Permit type-only `react` imports in `utils/`, on the grounds that a type carries no runtime
  dependency and does not make the module non-portable; or
- Move the file to `components/`, where it is exclusively consumed anyway (the layout helpers
  `fitMediaStyle`, `fitMediaWidth`, `fitMediaMaxWidth` are used only by scan-step components).

The second is the stronger reading of "strict leaf" and matches where the file is used. Whichever
is chosen, state it in `docs/agents/conventions.md` so issue 05's rule can be written to match.

Move each file's test alongside it, following the same mirror rule as issue 03.

## Acceptance criteria

- [ ] `utils/` contains no import from `@/pipeline`, `@/hooks`, `@/components`, or `@/app` —
      verified by grep across the whole directory, type-only imports included.
- [ ] `backdropLuma`, `cropTrace`, and `shipDiagnostics` live in the `pipeline/` subdirectory
      matching the module each already depends on.
- [ ] `MediaPipeVariant` is declared in `pipeline/pose/poseDetection.ts`; `hooks/usePoseModel.ts`
      imports it from there and no longer declares it.
- [ ] `poseTiers` lives in `pipeline/pose/`.
- [ ] The `mediaContainerStyle` decision is applied and recorded in `docs/agents/conventions.md`.
- [ ] Every moved file's test moved with it, preserving the source-tree mirror.
- [ ] No exported function, type, or constant changed name, signature, or body.
- [ ] `npx tsc --noEmit` passes with zero output.
- [ ] `npx eslint .` passes.
- [ ] **Full** `npx vitest run` passes with the same test count as before.

## Comments

- `pipeline/CLAUDE.md` requires pipeline modules to have zero React imports and to take `cv` as
  their first argument where they use OpenCV. Check each relocated file against those rules before
  the move — if one of them fails, that is a signal it does not belong in `pipeline/` and needs a
  different home rather than an exception.
- `storage/sessionStore.ts` re-exports `CropBox` from `pipeline/tracking/cropDetector` and
  `PoseBackend` from `utils/`, acting as an implicit barrel across three layers. That is legal
  under the target graph (`storage/ → pipeline (types), utils`) and is deliberately left alone.
