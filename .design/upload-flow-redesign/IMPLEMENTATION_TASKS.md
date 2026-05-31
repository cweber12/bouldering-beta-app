# Upload Flow Redesign Implementation Tasks

## Session Context Summary

- Brief completed: [ .design/upload-flow-redesign/DESIGN_BRIEF.md ](.design/upload-flow-redesign/DESIGN_BRIEF.md)
- Locked decisions: guided wizard, one primary CTA per step, auto-suggest with manual override, confidence checkpoint before save, optional route-photo branch, equal mobile/desktop priority.
- Hard constraints: detection quality and output data must remain unchanged.

## Execution Rules

- Do not change pose/ORB algorithm behavior.
- Keep semantic color tokens and theme conventions from [app/globals.css](app/globals.css).
- Keep crop overlay mapping and viewport-fit media container behavior intact.
- Preserve API/storage contracts for saved runs.

## Ordered Vertical Slices

- [x] 1. Build process-flow shell and progress model
  - Scope: create a reusable shell for upload flow with step title, step index, single primary action slot, optional secondary actions.
  - Files:
    - New: components/scan/process-flow/ProcessFlowShell.tsx
    - Update: app/upload/page.tsx
  - Acceptance criteria:
    - Step states are visually consistent across pick/detection/results/match.
    - Exactly one dominant CTA is visible per step.
    - Mobile has sticky CTA area without covering media.
    - Keyboard focus order remains logical.

- [x] 2. Redesign source selection step for clarity and momentum
  - Scope: improve StepPickVideo hierarchy, copy, and interaction feedback while preserving upload/record behavior.
  - Files:
    - Update: components/scan/process-flow/StepPickVideo.tsx
  - Acceptance criteria:
    - User can understand next action within 3 seconds.
    - Upload and record options are clearly differentiated.
    - Visual style avoids generic card boilerplate and excessive borders.

- [x] 3. Simplify detection setup with progressive advanced controls
  - Scope: keep climber crop as primary; hide model/frame-step controls behind explicit Advanced toggle.
  - Files:
    - Update: components/scan/process-flow/StepSetDetection.tsx
    - Update: app/upload/page.tsx
  - Acceptance criteria:
    - Climber crop + Scan remains the default path.
    - Advanced controls are discoverable but not distracting.
    - One-click return path from low-confidence suggestions lands user here.

- [x] 4. Add confidence checkpoint in landmarks results
  - Scope: introduce a single pass/warn quality summary card using existing metrics (matches, frame coverage, processing state) and expandable advanced metrics.
  - Files:
    - New: components/scan/process-flow/QualitySummaryCard.tsx
    - New: components/scan/process-flow/FixSuggestionsPanel.tsx
    - Update: components/scan/process-flow/StepViewLandmarks.tsx
    - Update: app/upload/page.tsx
  - Acceptance criteria:
    - One clear quality state is shown before save.
    - Warn state provides targeted recovery actions.
    - Advanced metrics remain available but collapsed by default.

- [x] 5. Make route-photo overlay an explicit optional branch
  - Scope: reposition route-photo step as optional continuation after core scan results.
  - Files:
    - Update: components/scan/process-flow/StepViewLandmarks.tsx
    - Update: components/scan/process-flow/StepMatchRoutePhoto.tsx
    - Update: app/upload/page.tsx
  - Acceptance criteria:
    - Core scan and save can complete without entering overlay step.
    - Optional branch label is explicit and consistent.
    - Returning from optional branch does not lose results context.

- [x] 6. Streamline save metadata sheet
  - Scope: shorten first-view metadata to essentials; keep optional fields in progressive disclosure.
  - Files:
    - Update: app/upload/page.tsx
    - Optional extraction: components/scan/modals/MetadataBottomSheet.tsx (if shared with scan page)
  - Acceptance criteria:
    - Required fields are immediately clear.
    - Optional details are available but unobtrusive.
    - Save/upload behavior and validation remain intact.

- [x] 7. Apply intentional motion and interaction polish
  - Scope: replace generic hover/click treatment with purposeful transitions (step transitions, CTA confirmation, panel reveals).
  - Files:
    - Update: components/scan/process-flow/*.tsx
    - Update: app/globals.css (only if adding reusable motion tokens/classes)
  - Acceptance criteria:
    - Motion reinforces state changes, not decoration.
    - Reduced-motion preference is respected.
    - No layout jank on mobile.

- [x] 8. Accessibility hardening pass
  - Scope: ensure keyboard and screen-reader support for all redesigned controls and modals.
  - Files:
    - Update: app/upload/page.tsx
    - Update: components/scan/process-flow/*.tsx
  - Acceptance criteria:
    - All controls are keyboard reachable and operable.
    - Step progress and quality status have clear accessible labels.
    - Modal focus handling is correct and Escape behavior is consistent.

- [x] 9. Test updates and regression protection
  - Scope: add or update tests for new flow shell, confidence logic, optional branch behavior, and metadata timing.
  - Files:
    - New/Update: __tests__/app/upload/* (or component-level tests under __tests__/components/scan/process-flow/*)
  - Acceptance criteria:
    - Existing upload/scan tests still pass.
    - New tests cover pass/warn summary and recovery links.
    - Optional branch behavior has explicit regression coverage.

- [x] 10. README and docs sync
  - Scope: update user-facing flow description to match redesign.
  - Files:
    - Update: README.md
    - Optional: components/README.md if shared primitives changed
  - Acceptance criteria:
    - Flow steps and save behavior reflect new UX.
    - Optional route-photo branch is documented as optional.

## Suggested Delivery Plan

- Milestone A: Tasks 1-3 (new shell + pick + detection)
- Milestone B: Tasks 4-6 (confidence + optional branch + save sheet)
- Milestone C: Tasks 7-10 (polish, a11y, tests, docs)

## Validation Checklist Per Milestone

- Run type check: npx tsc --noEmit
- Run tests: npx vitest run
- Run coverage: npx vitest run --coverage
- Run lint: npx eslint .
