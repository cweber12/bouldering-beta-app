# Adaptive contrast for Skeleton & Holds overlays

Status: ready-for-agent
Type: AFK

## Problem Statement

When the Skeleton and Holds overlays are drawn over a route, their colours can blend into the wall behind them. A cyan hand-ring on a cyan-painted hold, a bright-lime skeleton on a pale slab, or an orange foot-ring on sandstone can all lose contrast against the exact pixels they sit on — the mark and its backdrop end up at nearly the same brightness, so the overlay the climber is trying to read partially disappears. Today the palette is fixed regardless of the wall, so legibility is luck of the draw per route.

## Solution

Automatically nudge overlay colours for legibility against the surface they are drawn on, without changing what any colour _means_. The overlay samples the backdrop's brightness and, for each palette colour that would fail a contrast target against that backdrop, shifts only its lightness (with saturation used to keep the hue recognisable) just far enough to become legible. Hue never moves, so cyan still means Hand Hold, orange still means Foot Hold (ADR 0012), and the anatomical Skeleton palette keeps its identity. A single **Auto-contrast** toggle (default on) in the overlay panel gates the whole behaviour; turning it off renders exactly today's colours, so the feature is purely additive and can never regress the current look.

## User Stories

1. As a climber reviewing my ascent, I want the Skeleton to stay visible against a bright slab, so that I can follow my body position without the overlay washing out.
2. As a climber reviewing a route with cyan-painted holds, I want the cyan Hand-Hold rings to remain distinct from the wall, so that I can still tell where the hand holds are.
3. As a climber on a dark-rock route, I want the orange Foot-Hold rings to stay legible, so that I can read the foot sequence.
4. As a climber, I want a Hand Hold to always read as cyan and a Foot Hold as orange regardless of the wall, so that the colour code (ADR 0012) never lies to me.
5. As a colour-blind climber, I want the Hand/Foot colour distinction preserved after any contrast adjustment, so that the accessibility guarantee of the cyan/orange pair still holds.
6. As a climber, I want the anatomical Skeleton palette (green torso, cyan arms, orange legs, left/right variants) to keep its meaning after adaptation, so that limbs stay identifiable.
7. As a climber, I want the arm and leg colour gradients to stay smooth ramps after adaptation, so that limbs don't invert or band.
8. As a user, I want a single Auto-contrast toggle in the overlay panel, so that I can turn the whole behaviour on or off in one place.
9. As a user, I want Auto-contrast on by default, so that overlays are legible without me configuring anything.
10. As a user who turns Auto-contrast off, I want the overlay to render exactly the original palette, so that I can always get back to the literal colours.
11. As a user who manually picks an overlay colour, I want Auto-contrast (while on) to still keep my colour legible against the wall, so that a bad manual choice doesn't vanish.
12. As a user, I want overlay colours to change only when a colour genuinely risks disappearing, so that the palette isn't needlessly bleached on routes where it already reads fine.
13. As a climber on a busy, high-variance wall, I want the overlay to shift more decisively, so that the mark clears the wall's whole brightness range rather than just its average.
14. As a climber on a flat, uniform wall, I want only a gentle nudge, so that the overlay stays close to the brand palette.
15. As a climber watching the post-scan preview (Skeleton over the wall crop), I want the Skeleton to contrast the wall texture, so that the live pose reads clearly before I've matched a route photo.
16. As a climber viewing the route-photo overlay, I want the Skeleton and Holds tuned to the route photo's pixels, so that they contrast the actual backdrop they're drawn on.
17. As a user saving an annotated run, I want the saved WebM to carry the same adapted colours I saw in the preview, so that what I approved is what gets stored.
18. As a user replaying a saved run later, I want its overlay colours to still contrast the route photo behind it, so that the stored video reads correctly wherever it's viewed.
19. As a user on the Compare page, I want each climber's overlay to stay distinguishable from the others after adaptation, so that I don't confuse two climbers.
20. As a user on the Compare page, I want each overlay still legible against the shared route photo, so that thin multi-climb lines don't blend into the wall.
21. As a developer tuning the feature, I want the contrast target and band width exposed as named constants, so that I can adjust aggressiveness against real routes without touching logic.
22. As a developer, I want the contrast maths isolated in a pure module, so that I can unit-test it without a canvas or OpenCV.
23. As a developer, I want the overlay colouring to not depend on OpenCV readiness, so that the route-photo overlay colours correctly the instant the photo loads.
24. As a maintainer, I want no persisted schema change, so that existing saved runs load unchanged and nothing needs migration.

## Implementation Decisions

**New pure module — `contrastAdapter` (in `pipeline/overlay/`).** Framework-agnostic, no React, no OpenCV. Exposes:

- A `ContrastAdjust` value derived from backdrop luminance stats `{ meanLuma, stdLuma }` plus the tuning constants.
- `adaptColor(css, adjust)` → css string: for a source colour, if its Rec. 709 relative-luminance contrast against the backdrop band fails the target ratio, shift **lightness only** the minimum amount to reach the target (biasing the direction that keeps the hue recognisable); otherwise return the colour unchanged. Saturation is used for _vividness rescue_ — raised when a lightness push toward an extreme would wash the hue out — and is **never reduced** below the authored value. Hue is never changed.

**Contrast model.** Global per surface, per-colour-identity. Target contrast ratio and band multiplier are named constants at the top of the module: **target = 3:1** (WCAG graphical-object bar), **k = 1.0**. A colour must clear the target against the near edge of the backdrop band `mean ± k·stdDev` (light or dark side, whichever it must beat). Low-variance walls → gentle nudge; high-variance walls → firmer shift.

**Backdrop luminance sampling (hook layer).** Split into a pure pixel-math function (`ImageData → { meanLuma, stdLuma }`, Rec. 709 `0.2126R + 0.7152G + 0.0722B`) and a thin DOM wrapper that draws the backdrop (or the wall-crop rect) to a small offscreen canvas (~64px long edge) and reads it back. No OpenCV — the overlay colour path must not depend on WASM readiness (`FramePlayer` is cv-free today). The same Rec. 709 formula is used for both backdrop and overlay-colour luminance so the scales match.

**Per-surface backdrop:**

- Post-scan preview (Skeleton over video) → sample the **wall crop**.
- Route-photo overlay, saved WebM, and Compare → sample the **route photo**.

**Threading (architecture choice: adapter output flows down, palettes stay in the draw modules).** `SkeletonStyle` gains an optional `contrastAdjust`; `HoldStyle` gains an optional `contrastAdjust`. `drawSkeleton` and `drawHolds` wrap **every colour emission** in `adaptColor(...)`. Two ordering rules:

- Apply `adaptColor` to the **base** colour _before_ the Silhouette derives its relative depth shades (dark rim / light core), so the shading stays relative to the nudged base.
- Adapt anatomical gradient **endpoints together** (treat each arm/leg ramp as one identity) so ramps don't compress or invert.

**UI — Auto-contrast toggle.** A single toggle added to `SkeletonStylePanel`, default **on**, placed above the Silhouette row. It gates both the Skeleton and Holds adaptation with one switch. When on, adaptation applies to whatever colours are active (default palette _or_ manual picks). When off, the panel emits no `contrastAdjust` and the overlay renders exactly today's output. The Holds section already has no colour picker (visibility only), consistent with ADR 0012 — that stays.

**Timing / memoisation (hook layer).** Compute the backdrop stat once per backdrop, memoised by `imageFile` identity (plus the crop rect for the wall-crop preview). Recompute only when the photo/crop changes or the Auto-contrast toggle flips. Never per-frame (per-frame would shimmer and is wasteful; the model is static-per-surface).

**Saved WebM.** Adaptation is **baked into** the rendered WebM: `poseVideoRenderer` and `multiPoseVideoRenderer` receive the same `ContrastAdjust` (computed from the route photo) that the preview used, so what-you-see-is-what-you-save. The adjustment is recomputed deterministically from the route photo at render time — **nothing is persisted**, so there is **no schema change** and no migration.

**Compare page.** One adaptation path, applied normally. The hue-lock invariant preserves climber-vs-climber distinction (slots differ by hue, which never moves), so wall-contrast adaptation can only slide lightness within each hue. The shared white joint colour is **excluded** from adaptation (neutral anchor). No inter-slot separation constraint solver — deferred until a real collision appears.

**Safety property.** With Auto-contrast off, or when sampling yields a neutral/failed result, the overlay falls back to exactly today's palette. The feature is additive by construction.

## Testing Decisions

Good tests here exercise **external behaviour at the highest (purest) seam**, not canvas internals. The contrast maths is pure, so almost all real coverage lives in two pure functions; the draw modules only get a light "the param threads through" check.

- **`contrastAdapter` (primary seam, pure).** Unit-test `adaptColor` and `computeContrastAdjust` directly, mirroring the existing pure-pipeline tests (`homography.test.ts`, `poseInterpolator.test.ts`). Behaviours to assert:
  - A colour that already clears the target against a given backdrop passes through **unchanged**.
  - A failing colour is shifted to **exactly** the target ratio (minimal nudge), no further.
  - **Hue is invariant** across adaptation (parse back to HSL, compare hue).
  - **Saturation never decreases** below the authored value.
  - A low-variance vs high-variance backdrop (same mean, different stdDev) produces a **larger** shift for the busier wall.
  - Direction: a colour on a dark wall moves lighter; on a bright wall, darker.
- **Backdrop luminance stat (pure half).** Test `ImageData → { meanLuma, stdLuma }` with plain-object `ImageData` casts (the jsdom pattern in CLAUDE.md — `ImageData` is unavailable in jsdom). Assert Rec. 709 weighting (a pure-green field reads brighter than pure-blue at equal channel value) and correct mean/stdDev on a known checkerboard. The DOM downscale wrapper is a thin integration seam and stays untested.
- **`skeletonOverlay` / `holdsOverlay` (thread-through only).** Extend the existing test files. Using a mock 2D context that records `strokeStyle` / `fillStyle` assignments, assert that passing a `contrastAdjust` changes the emitted colours and that omitting it reproduces today's colours. Do **not** re-test the adapter maths here — that is covered at the pure seam. Prior art: `holdsOverlay.test.ts` already drives `drawHolds` against a mock context.

## Out of Scope

- **Hue shifting** of any overlay colour — explicitly rejected to preserve ADR 0012 and the anatomical palette.
- **Local / per-element** sampling (per-ring or per-limb backdrop) — the model is one global adjustment per surface; holds and skeleton both use it.
- **Per-frame** re-sampling of a moving Skeleton — ruled out (shimmer, cost).
- **Chroma-contrast from wall saturation** (boosting overlay saturation on grey walls) — would need a new wall-saturation stat in `frameAnalyzer`; deferred. Saturation is used only for vividness rescue.
- **Histogram / percentile** backdrop analysis — `mean ± k·stdDev` from existing-style grayscale stats is sufficient; deferred until a real failure the band can't handle.
- **Inter-slot separation constraint solver** on Compare — hue-lock covers distinction for now.
- **Persisting the adjustment** as data or any storage-schema change.
- **Reusing `frameAnalyzer`/OpenCV** for overlay-colour sampling — intentionally avoided to keep the colour path cv-free.

## Further Notes

- The `ContrastAdjust` is a small value object (backdrop luminance band + the target/`k` constants); `adaptColor` does the per-colour work so the same object serves every colour identity from one backdrop sample.
- A helpful (optional) dev aid: a swatch strip on the existing `/dev/orb-bench` showing each palette colour before/after against a sampled wall, to tune `k` and the target ratio against real routes. Not required for the feature.
- Watch the Silhouette depth-shade derivation: those shades are computed as lightness shifts of the base colour, so adapting the **base** before deriving them keeps the rim/core relationship intact automatically.
- Keep the constants (`TARGET_CONTRAST_RATIO`, `BAND_K`) named and top-of-file so tuning is a one-line change.
