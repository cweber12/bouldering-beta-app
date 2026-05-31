# Global UI Refresh Implementation Tasks

## Session Context Summary

- Brief completed: [ .design/global-ui-refresh/DESIGN_BRIEF.md ](.design/global-ui-refresh/DESIGN_BRIEF.md)
- Locked decisions: professional tool-like UI, Strava-like user flow ergonomics, no cards for non-selectable elements, stronger cross-page cohesion.
- Route scope:
  - No page scroll: `/upload`, `/scan`, `/view`, `/compare`, `/match`
  - Scroll allowed: `/profile`, `/login`, `/`, `/docs`
- Hard constraints: maintain exact behaviors and keep current component APIs.

## Execution Rules

- Do not change processing/business behavior (pose, ORB, matching, storage, auth, route logic).
- Keep semantic token system and theme conventions from [app/globals.css](app/globals.css).
- Keep existing component APIs stable (props/events contracts unchanged unless strictly additive).
- Do not use card styling for non-selectable/static informational sections.
- Preserve accessibility baseline and improve toward WCAG AA consistency.

## Ordered Vertical Slices

- [x] 1. Create a reusable viewport-fit shell for core tool routes
  - Scope: introduce a shared layout primitive that enforces nav-aware in-window composition and local-region overflow handling for tool pages.
  - Files:
    - New: components/shared/ToolPageShell.tsx
    - Update: app/upload/page.tsx
    - Update: app/scan/page.tsx
    - Update: app/match/page.tsx
    - Update: app/view/page.tsx
    - Update: app/compare/page.tsx
  - Acceptance criteria:
    - No page-level vertical scrolling on scoped tool routes at common desktop/mobile viewport sizes.
    - Internal regions (panels/sheets/lists) may scroll without breaking primary-action visibility.
    - Existing route behaviors remain unchanged.

- [x] 2. Standardize top-level tool route structure and hierarchy
  - Scope: unify each tool route around a consistent structure (header context, workspace, action region) to reduce page-to-page friction.
  - Files:
    - Update: app/upload/page.tsx
    - Update: app/scan/page.tsx
    - Update: app/match/page.tsx
    - Update: app/view/page.tsx
    - Update: app/compare/page.tsx
  - Acceptance criteria:
    - Header/action placement is predictable across all tool routes.
    - Primary actions are immediately discoverable.
    - Visual hierarchy is cleaner and less themed.

- [ ] 3. Replace non-selectable card surfaces with neutral section treatments
  - Scope: audit static sections and swap card-like backgrounds/borders for divider-led, neutral surfaces while preserving interactive affordances where selectable.
  - Files:
    - Update: app/upload/page.tsx
    - Update: app/scan/page.tsx
    - Update: app/match/page.tsx
    - Update: app/view/page.tsx
    - Update: app/compare/page.tsx
    - Update: components/shared/*.tsx (as needed)
  - Acceptance criteria:
    - Non-interactive content no longer uses card UI.
    - Selectable rows/tiles/cards remain clearly interactive.
    - Perceived UI density remains readable and uncluttered.

- [ ] 4. Tighten global control language for professional cohesion
  - Scope: harmonize control radius, border weights, spacing rhythm, and focus styling across nav, inputs, chips, toggles, and lightweight toolbars.
  - Files:
    - Update: app/globals.css
    - Update: components/shared/NavBar.tsx
    - Update: components/shared/ComboInput.tsx
    - Update: components/shared/LocationAutocomplete.tsx
    - Update: components/shared/ClimbOptionsDropdown.tsx
    - Update: components/scan/process-flow/*.tsx
  - Acceptance criteria:
    - Controls feel like one system across routes.
    - Focus/hover/active states are consistent and accessible.
    - Styling shifts improve polish without behavior regressions.

- [ ] 5. Apply viewport-fit media workspace constraints
  - Scope: ensure media-heavy views use nav-aware size constraints with min-h-0 and local overflow control so content stays in-window on scoped routes.
  - Files:
    - Update: app/upload/page.tsx
    - Update: app/match/page.tsx
    - Update: app/view/page.tsx
    - Update: app/compare/page.tsx
    - Update: components/scan/process-flow/StepMatchRoutePhoto.tsx
  - Acceptance criteria:
    - Media no longer overflows the viewport in normal use.
    - Key controls remain visible while interacting with media.
    - Crop/overlay behaviors remain pixel-accurate.

- [ ] 6. Refine motion and feedback to support tool-like confidence
  - Scope: reduce decorative effects, keep purposeful transitions, and normalize loading/success/error/caution feedback blocks.
  - Files:
    - Update: app/globals.css
    - Update: components/shared/*.tsx
    - Update: components/scan/process-flow/*.tsx
  - Acceptance criteria:
    - Motion communicates state changes and respects reduced-motion.
    - Feedback blocks are semantically consistent across pages.
    - UI feels calmer and more professional.

- [ ] 7. Accessibility and keyboard hardening for revised layouts
  - Scope: validate keyboard order and focus management after viewport/layout updates, including modals/sheets and internal scroll regions.
  - Files:
    - Update: app/upload/page.tsx
    - Update: app/scan/page.tsx
    - Update: app/match/page.tsx
    - Update: app/view/page.tsx
    - Update: app/compare/page.tsx
    - Update: components/shared/*.tsx
  - Acceptance criteria:
    - WCAG AA contrast targets maintained.
    - Keyboard traversal remains logical in all updated routes.
    - Dialog/sheet escape and focus behavior remains correct.

- [ ] 8. Add regression tests for no-scroll and cohesion rules
  - Scope: add tests covering shell behavior, route-level overflow constraints, and no-card usage for static sections where testable.
  - Files:
    - New/Update: __tests__/components/shared/ToolPageShell.test.tsx
    - New/Update: __tests__/app/* (targeted route tests)
    - Update: existing process-flow/component tests as needed
  - Acceptance criteria:
    - New shell/layout behavior has explicit regression coverage.
    - Existing tests remain green.
    - Coverage reflects touched source paths.

- [ ] 9. Documentation sync for new global UI standards
  - Scope: document route scroll policy, surface semantics (no card for static content), and shared shell usage.
  - Files:
    - Update: README.md
    - Optional: components/README.md
    - Optional: app/docs/page.tsx (if user-facing behavior descriptions need updates)
  - Acceptance criteria:
    - Developer docs reflect new layout/surface conventions.
    - Route-by-route expectations are explicit.

## Suggested Delivery Plan

- Milestone A: Tasks 1-3 (shared shell + structural hierarchy + surface semantics)
- Milestone B: Tasks 4-6 (control language + media fit + motion/feedback)
- Milestone C: Tasks 7-9 (accessibility, tests, docs)

## Validation Checklist Per Milestone

- Run type check: `npx tsc --noEmit`
- Run tests: `npx vitest run`
- Run coverage: `npx vitest run --coverage`
- Run lint: `npx eslint .`
