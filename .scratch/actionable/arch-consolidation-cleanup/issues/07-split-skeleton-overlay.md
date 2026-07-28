# Split skeletonOverlay.ts along its real seams

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-consolidation-cleanup/PRD.md`
- Rules: `pipeline/CLAUDE.md`

## Blocked by

Issue 04 — it extracts the colour library that is one of this file's three parts. Landing 04 first
means this split has one fewer seam to invent.

## What to build

`pipeline/overlay/skeletonOverlay.ts` is 1,029 lines holding three separable modules:

1. **The colour library** — `parseRgb`, `rgbToHsl`, `hueToRgb`, `hslToCss`, `mixCss`, `shiftHue`,
   `shiftLightness` (lines 344–441). Issue 04 already moves the first four out; move `mixCss`,
   `shiftHue`, and `shiftLightness` to join them.
2. **The geometry helpers** — `midpoint`, `dist`, `bodyScale`, `computeHeadGeometry`. `dist` goes
   to `utils/` in issue 04; the remaining three are skeleton-specific geometry and belong in their
   own module under `pipeline/overlay/`.
3. **The drawing routines** — `buildTransformedKeypoints`, `drawSkeleton`, `lerpKeypoints`, the
   two-pass silhouette/skeleton render, and the anatomical per-limb colouring. This is what stays
   in `skeletonOverlay.ts`.

A pure split: no function changes name, signature, or body. Public exports must keep working from
their existing import paths or be updated at every call site — `skeletonOverlay` is imported by
`XrayStage`, `SkeletonStylePanel`, `LandingReplay`, `FramePlayer`, `CompareSlot`,
`CompareOverlayPlayer`, `StepMatchRoutePhoto`, `StepViewLandmarks`, `Analyzer`, `app/scan/page.tsx`,
`app/dev/landing-clip/page.tsx`, and `skeletonRenderer.ts`. Prefer updating the call sites over
leaving a re-export barrel; a barrel would recreate the two-import-paths problem that
`utils/cropFraction.ts` and `components/capture/CropBoxOverlay.tsx` already have.

Every new module must satisfy `pipeline/CLAUDE.md`: zero React imports, `cv` threaded explicitly
as a parameter where used, no `async`, and OpenCV allocations freed in a `finally` block.

Split `__tests__/pipeline/skeletonOverlay.test.ts` to follow the new modules, keeping every
existing assertion.

## Acceptance criteria

- [ ] `pipeline/overlay/skeletonOverlay.ts` holds only the drawing routines and is materially
      smaller than 1,029 lines.
- [ ] The remaining colour functions (`mixCss`, `shiftHue`, `shiftLightness`) live with the colour
      module issue 04 created.
- [ ] `midpoint`, `bodyScale`, and `computeHeadGeometry` live in their own `pipeline/overlay/`
      module.
- [ ] No function changed name, signature, or body — the diff is moves and import lines only.
- [ ] No re-export barrel is left behind; call sites import from the module that owns the function.
- [ ] Every new module has zero React imports and complies with `pipeline/CLAUDE.md`.
- [ ] Tests are split to match, with every existing assertion preserved and the total count
      unchanged.
- [ ] `npx tsc --noEmit` passes with zero output.
- [ ] `npx eslint .` passes, including the boundary and filename rules from the foundation PRD.
- [ ] **Full** `npx vitest run` passes with the same total test count as before.

## Comments

- `pipeline/` is the best-covered layer in the repo — 26 of 27 modules tested behind 507
  assertions — which is why this split is verified by `tsc` plus the existing suite rather than by
  new tests. That coverage is the reason UI files of similar size are explicitly out of scope.
