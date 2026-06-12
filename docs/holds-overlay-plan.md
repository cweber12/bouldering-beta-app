# Holds overlay — implementation plan

A third overlay pass, **Holds**, marking where the Climber's hands and feet were
used on the wall, numbered by order of first use. Design, terminology, and rejected
alternatives are recorded in:

- **CONTEXT.md** — glossary: Hold, Hand Hold, Foot Hold, Dwell, Holds (pass).
- **docs/adr/0007-hold-detection-overlay.md** — every decision + why, and the
  alternatives that were rejected. **Read this first** — it is the source of truth.

This file is just the build checklist. If it conflicts with ADR 0007, the ADR wins.

## Key implementation wrinkle (not in the ADR)

`RenderedSkeletonFrame.keypoints` is typed `Record<string, {x, y}>` — it **drops the
confidence score** that the confidence guard (ADR 0007, option 3) needs. Scores do
survive at runtime through `lerpKeypoints`, but they are not typed and must not be
relied on.

Therefore `detectHolds` consumes the **raw scored `PoseFrame[]`** (`attempt.frames`,
normalized [0,1], already smoothed) **plus a projector callback** `(pt, t) => {x, y}`
that the hook builds from `matchResult.homography` (Fixed Capture) or per-keyframe
`homographyAtTime` (Panning Capture). This keeps scores clean, handles both capture
modes, and reuses no `SkeletonFrameData` internals. All distances are fractions of a
photo-space `bodyScale` (median-stable shoulder width, computed from projected
shoulders).

## Balanced default constants (top of pipeline/holdDetection.ts)

- min dwell: 0.5 s
- stationary radius: 0.18 × bodyScale
- same-kind merge radius: 0.25 × bodyScale
- hand-above-wrist margin: 0.05 × bodyScale
- knee-straighten threshold: +20° (interior hip–knee–ankle angle increase across dwell)
- braced: knee angle < 160° OR |ankle.x − hip.x| ≥ 0.15 × bodyScale
- confidence guard: contact keypoint score ≥ 0.4 for ≥ 50% of the dwell window (time-weighted)
- hand point: mean(index, pinky), fallback wrist. foot point: mean(foot_index, heel), fallback ankle.

## Sequenced steps

1. **Tokens.** `app/globals.css`: add `--color-hand-hold` (cyan) / `--color-foot-hold`
   (orange) in the `@theme inline` (dark) block + `.theme-light` overrides.
   `utils/theme.ts`: add `handHold` / `footHold` to the `dark` and `light` objects.
   (Follow the CLAUDE.md color-token rules — no raw palette classes.)

2. **`pipeline/holdDetection.ts`** (pure; zero React; no `cv`). Constants at top.
   `Hold { id; kind: "hand" | "foot"; x; y; firstUseTime; order }`.
   `detectHolds(frames: PoseFrame[], project, bodyScale, opts?) → Hold[]`.
   Internals: per-limb (L/R hand, L/R foot) dwell scan (time-weighted window) →
   confidence guard → hand above-wrist / foot knee-or-braced gate → merge by
   kind + location → assign `order` by `firstUseTime`.

3. **`pipeline/holdsOverlay.ts`** (pure). `drawHolds(ctx, holds, t, style, bodyScale)`:
   filled disc + dark ring + white centered number, gated `firstUseTime ≤ t`; drop
   points outside the canvas bounds. Framework-agnostic so a future WebM path reuses it.

4. **`hooks/useHolds.ts`.** Mirror `useSkeletonFrames` deps (`attemptId`, `matchResult`).
   Build the projector from `matchResult.homography` or `keyframeHomographies`
   (`homographyAtTime`). Return `{ holds, status }`.

5. **`components/skeleton/FramePlayer.tsx`.** Add `holds?: Hold[]` + `holdStyle?: HoldStyle`
   props; keep them in refs like `layersRef`; in `drawFrame`, after the skeleton layers,
   call `drawHolds(ctx, holds, t, holdStyle, scale)`.

6. **`components/skeleton/SkeletonStylePanel.tsx` → Overlay panel.** Rename the label to
   "Overlay". Add a **Holds** row: visibility checkbox + two color pickers defaulting to
   the new tokens. Emit a `HoldStyle` (separate from `SkeletonStyle`).

7. **Wire consumers** (every live FramePlayer Route Overlay): `StepMatchRoutePhoto`,
   `CompareSlot` / `CompareOverlayPlayer`, `RouteConsole`. Call `useHolds`, pass
   `holds` / `holdStyle` to `FramePlayer`, connect the panel's Holds state.
   **Not** StepViewLandmarks (Detection Preview has no homography — Holds excluded).
   **Not** the auto-rendered annotated WebM for v1 (stays pose-only).

8. **Tests.** `__tests__/pipeline/holdDetection.test.ts` with synthetic `PoseFrame[]` +
   identity projector: gripped-hand-above-wrist → Hand Hold; frozen low-confidence
   occlusion → none; stand-up foot → Foot Hold; braced foot → Foot Hold; hanging plumb
   leg → none; re-grip / two-hand match → one merged Hold; combined numbering order.
   No OpenCV; mock at the module boundary per AGENTS.md.

9. **Docs + checks.** Update `README.md` feature summary. Then run, in order:
   `npx tsc --noEmit` → `npx eslint .` → targeted `npx vitest run` → `git add . && git commit`.
   Delete this plan file once the feature lands.
