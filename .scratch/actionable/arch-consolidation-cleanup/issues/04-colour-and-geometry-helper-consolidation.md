# Consolidate the colour and geometry helpers

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-consolidation-cleanup/PRD.md`

## Blocked by

Nothing. Independent of issues 01–03 and 05–06.

## What to build

**The colour library is duplicated verbatim between two sibling files** in the same directory.
`parseRgb`, `rgbToHsl`, `hueToRgb`, and `hslToCss` appear at `pipeline/overlay/skeletonOverlay.ts`
lines 344, 358, 375, 384 and again at `pipeline/overlay/contrastAdapter.ts` lines 103, 117, 134, 151. The bodies are byte-identical **except one thing**: `parseRgb`'s fallback colour is
`{r:0, g:220, b:120}` in `skeletonOverlay.ts` and `{r:128, g:128, b:128}` in `contrastAdapter.ts`.

Extract one module — `pipeline/overlay/colour.ts` — and follow the divergent-duplicate rule from
`docs/agents/conventions.md`: `parseRgb(css, fallback)` takes the fallback as a required argument,
so each call site keeps producing exactly the colour it produces today. Do **not** pick one
fallback and let the other change: the skeleton-overlay fallback is what a skeleton renders when
its style string fails to parse, and `skeletonOverlay.ts` has no direct test coverage of that path.

`contrastAdapter.ts` also has `hslToRgb01` while `skeletonOverlay.ts` inlines the same maths inside
`hslToCss`. Both go in the new module. `components/skeleton/LandingReplay.tsx:140` has a third,
independent `hexToRgb` — fold it in as well.

**Extract the geometry helpers.** `dist` — a 2-D `Math.hypot` distance — is defined four times:
`pipeline/holds/holdDetection.ts:158`, `pipeline/overlay/skeletonOverlay.ts:333`,
`pipeline/pose/flipDetection.ts:172`, `harness/scoring.ts:310` (after the foundation-PRD rename).
`clamp` is defined at `components/capture/CropBoxOverlay.tsx:161`,
`components/capture/DualCropOverlay.tsx:95`, `components/dev/FrameStage.tsx:80`, with `clamp01` at
`pipeline/overlay/contrastAdapter.ts:91` and `harness/groundTruthScaffold.ts:40`.

`dist`, `clamp`, and `clamp01` are pure numeric leaf helpers with no pipeline or React dependency —
`utils/` is their correct home under the target graph, and it keeps `harness/` and `components/`
able to import them without reaching into `pipeline/`.

**Verify the copies are actually identical before merging.** Check edge-case handling in
particular: whether `clamp` handles an inverted min/max the same way in all three, and whether any
`dist` copy guards against non-finite input. Where they differ, the parameterised-variant rule
applies again.

## Acceptance criteria

- [ ] One colour module exists under `pipeline/overlay/` exporting `parseRgb`, `rgbToHsl`,
      `hueToRgb`, `hslToCss`, and `hslToRgb01`.
- [ ] `parseRgb` takes the fallback colour as an argument; `skeletonOverlay` passes
      `{0, 220, 120}` and `contrastAdapter` passes `{128, 128, 128}`, preserving both behaviours.
- [ ] A characterization test covers both fallbacks, plus round-tripping and malformed input for
      each converter, and passes before either call site migrates.
- [ ] `skeletonOverlay.ts` and `contrastAdapter.ts` contain no colour-conversion function bodies.
- [ ] `hexToRgb` in `LandingReplay.tsx` is replaced by the shared implementation.
- [ ] `dist` has one definition in `utils/`; the four former copies are gone.
- [ ] `clamp` and `clamp01` have one definition each in `utils/`; the five former copies are gone.
- [ ] Any behavioural difference found between copies is preserved via a parameter and recorded in
      `## Comments`.
- [ ] `npx tsc --noEmit`, `npx eslint .`, and **full** `npx vitest run` pass.

## Comments

- Two files in the same directory holding byte-identical colour code with different fallback
  constants is the clearest example in the repo of duplication that has already drifted. Neither
  copy is wrong; they simply stopped being the same function.
- Issue 07 splits `skeletonOverlay.ts`. This issue takes the colour half out first, so 07 has one
  fewer seam to invent. Land this before 07.
