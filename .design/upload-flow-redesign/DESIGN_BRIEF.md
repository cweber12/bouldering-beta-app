# Design Brief: Upload Flow Redesign

## Problem

As a climber trying to analyze a run, I need to get from raw video to a trustworthy saved scan quickly. The current flow makes me think about too many controls and branches before I understand what matters, so I lose confidence and momentum even when the underlying detection quality is strong.

## Solution

Design a guided, mobile-equal upload experience that makes one decision at a time, keeps technical controls available but secondary, and gives a clear confidence checkpoint before save. The interface should preserve the exact pose/ORB output quality while reducing cognitive load: fast happy path for most users, clear recovery path when quality is low, and optional route-photo overlay as a distinct post-processing branch.

## Experience Principles

1. Guided progression over control overload -- show one primary action per step, progressively reveal advanced controls, and keep optional branches visually separate.
2. Confidence before commitment -- always provide a simple pass/warn quality summary and actionable fix suggestions before save/upload.
3. Speed without hidden tradeoffs -- optimize for under-2-minute completion while keeping detection fidelity unchanged and exposing advanced settings when users need them.

## Aesthetic Direction

- **Philosophy**: Technical confidence with athletic clarity (Strava-like activity flow applied to computer vision workflow).
- **Tone**: Confident and technical.
- **Reference points**: Strava activity flow (progressive completion), Lightroom-like guided adjustment moments (focused controls), Figma-like metric clarity (clean data summaries).
- **Anti-references**: Generic AI-looking cards/layouts, generic copy, excessive borders, and boilerplate hover/click motions.

## Existing Patterns

Components, tokens, and conventions already in the codebase that this design must respect or extend.

- Typography: Geist Sans and Geist Mono via [app/layout.tsx](app/layout.tsx).
- Colors: Semantic CSS tokens in [app/globals.css](app/globals.css) including status tokens (`danger`, `caution`, `send`, `attempt`) and surface/edge/focus conventions.
- Spacing: Existing compact control rhythm in process-flow components (rounded `xl`, small toolbar controls, dense vertical stacking), with viewport-fit media containers from `mediaContainerStyle` utilities.
- Components: Existing process-flow steps and shared primitives should be extended, not replaced: Step components in [components/scan/process-flow](components/scan/process-flow), `CropBoxOverlay`, `FramePlayer`, `SkeletonStylePanel`, `ComboInput`, `CameraRecorderModal`, `SaveDropdown`, and metadata/map modals from scan flow.

## Component Inventory

| Component | Status | Notes |
| --------- | ------ | ----- |
| Process flow shell (step header, progress, primary CTA rail) | New | Introduce a single reusable shell wrapping each step with clear step title, progress, and one dominant action. |
| StepPickVideo | Modify | Elevate source selection hierarchy, add concise value framing, improve mobile-first visual affordance and motion. |
| StepSetDetection | Modify | Keep crop + params, but prioritize climber crop + scan CTA; move advanced settings behind explicit Advanced toggle; improve one-click return path. |
| StepViewLandmarks | Modify | Add confidence summary card (pass/warn) with targeted fix suggestions; keep advanced metrics expandable. |
| StepMatchRoutePhoto | Modify | Keep as optional branch with clear label Optional route overlay; avoid making it part of required completion path. |
| Metadata save sheet | Modify | Keep post-scan timing; shorten to essential fields first and progressive optional details. |
| Quality summary badge/card | New | Single overall quality score/state computed from existing metrics (ORB matches, frame coverage, processing success). |
| Targeted fix suggestions panel | New | Contextual remediation actions (re-crop climber, adjust ORB crop, re-run with different frame step/model) with direct deep links. |
| Motion primitives (step transitions, CTA feedback) | Modify | Replace generic hover effects with intentional transition choreography and state-confirmation feedback. |

## Key Interactions

1. Source selection: User chooses Upload or Record. Interface immediately advances to detection setup with persistent contextual breadcrumb and minimal chrome.
2. Detection setup: User scrubs video, sets climber crop, optionally adjusts advanced settings (model/frame step), then runs scan from one primary CTA.
3. Processing feedback: During processing, user sees clear progress and lightweight ETA; no competing actions.
4. Results checkpoint: User sees animated landmark preview plus a single confidence summary (pass/warn). Advanced metrics are available on demand, not primary.
5. Low-confidence recovery: If warn, show targeted fix actions and a one-click jump back to detection with preserved context.
6. Optional overlay branch: User can enter route-photo overlay as an explicit optional branch after core scan results are ready.
7. Save completion: User opens short save sheet after successful scan, adds required metadata, optionally adds extras, then uploads/saves.

## Responsive Behavior

- Mobile and desktop are equal priority.
- On mobile, step shell uses stacked controls with sticky primary CTA region; advanced settings and metrics collapse by default.
- On desktop, media preview and key controls can appear side-by-side only when this does not reduce clarity of the primary action.
- Optional route-photo branch remains visually separate on all breakpoints, with fullscreen preview behaviors preserved for crop overlays.
- Maintain existing viewport-fit media container patterns so crop fractions remain pixel-accurate.

## Accessibility Requirements

- Minimum text contrast: 4.5:1 for body/UI text, 3:1 for large text/icons, using existing semantic token system.
- Full keyboard operation for every interaction: source pick, crop step controls, advanced toggles, save sheet, and optional overlay branch.
- Clear visible focus states using existing focus ring behavior; no focus traps except intentional modal contexts.
- Screen-reader clarity: descriptive step titles, progress announcements during processing, and explicit labels for confidence pass/warn status.
- Motion accessibility: keep transitions meaningful but short and respect reduced-motion preferences.

## Out of Scope

- Changes to pose/ORB detection algorithms, model internals, or homography computation logic.
- Any reduction in data fidelity or output schema for saved scans.
- Re-architecting pipeline modules or moving OpenCV execution off main-thread.
- Broad app-wide visual redesign outside upload/scan process flow and directly related shared components.
