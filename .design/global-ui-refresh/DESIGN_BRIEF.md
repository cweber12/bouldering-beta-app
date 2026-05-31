# Design Brief: Global UI Refresh

## Problem

As a regular climber logging sessions, I need the app to feel precise and trustworthy so I can move through scan, match, compare, and view tasks quickly. The current interface feels generic and over-themed, visual hierarchy is inconsistent, and some core tool flows require avoidable vertical scrolling, which breaks momentum and confidence.

## Solution

Redesign the global interface language to feel cleaner, sharper, and more professional while preserving the approachable flow ergonomics that make Strava feel easy to use. The experience should read as a focused tool: clearer hierarchy, fewer decorative containers, tighter component cohesion, and route-level viewport-fit layouts for core workflows so users can complete key actions without page scrolling.

## Experience Principles

1. Utility clarity over decorative chrome -- remove visual noise, reserve emphasis for actions/states, and avoid card treatment for static/non-selectable content.
2. Viewport-fit workflow over document-style stacking -- core tool routes should keep primary controls and media in-window, with internal region scrolling only where unavoidable.
3. Cohesion over per-page reinvention -- nav, spacing rhythm, control shapes, and feedback patterns should feel like one system across scan, upload, match, view, and compare.

## Aesthetic Direction

- **Philosophy**: Performance-grade field tool with calm product polish.
- **Tone**: Professional and calm.
- **Reference points**: Strava flow ergonomics for step progression and completion momentum; Linear-level visual crispness and restraint.
- **Anti-references**: Over-themed gradients/chrome, chunky card-heavy layouts, playful consumer aesthetics, dense enterprise-table feel, heavy shadows/glassmorphism.

## Existing Patterns

Components, tokens, and conventions already in the codebase that this design must respect or extend.

- Typography: Geist Sans and Geist Mono loaded in app/layout.tsx.
- Colors: Semantic token system in app/globals.css using @theme inline and theme-light overrides; status tokens already exist for danger/caution/send/attempt.
- Spacing: Current UI favors compact controls (rounded-lg/rounded-xl, text-xs/text-sm) and process-flow composition with min-h-0 flex columns.
- Components: Reuse and extend shared primitives and process-flow pieces in components/shared and components/scan/process-flow (NavBar, ComboInput, CropBoxOverlay, Step* components, ProcessFlowShell, StepMatchRoutePhoto).
- Motion/accessibility baseline: Existing focus styles and reduced-motion-friendly transitions in globals should be retained and standardized.

## Component Inventory

| Component | Status | Notes |
| --------- | ------ | ----- |
| Global page frame primitive (viewport-fit shell for tool routes) | New | Shared layout wrapper for scan/upload/match/view/compare to enforce no-page-scroll behavior under nav height constraints. |
| NavBar alignment and action grouping | Modify | Tighten spacing/contrast hierarchy and maintain consistent interaction density across auth states without changing routes/behavior. |
| Surface semantics (panel vs selectable item) | Modify | Replace non-selectable cards with neutral surfaces/dividers; reserve card affordance for selectable/interactive objects only. |
| Tool route header/toolbar pattern | New | Standardized compact header row (title, context, primary actions) with predictable placement on each tool page. |
| Media workspace container pattern | Modify | Enforce viewport-fit media region using nav-aware max-height and internal region sizing to prevent overflow. |
| Form/control consistency pass (inputs, chips, toggles) | Modify | Unify radius, border contrast, hover/focus behavior, and spacing rhythm across pages using existing semantic tokens. |
| Feedback primitives (loading, success, caution, errors) | Modify | Standardize status blocks and toasts/banners using existing caution/danger/send tokens with consistent iconography and copy structure. |
| Route-specific layout adapters | Modify | Compare/match/view/upload/scan layout updates to use shared shell while preserving existing component APIs and behaviors. |

## Key Interactions

1. Tool-route entry: user lands on scan/upload/match/view/compare and immediately sees all critical controls and media within the viewport without document scrolling.
2. Primary action progression: each step/screen exposes one dominant next action with supporting controls grouped as secondary, reducing ambiguity.
3. Content hierarchy response: static explanatory content is rendered as simple text/surface sections; only selectable items use card affordances.
4. Cross-page continuity: moving between scan, match, view, and compare preserves familiar layout zones (header, workspace, action rail), reducing relearning costs.
5. Overflow handling: when content exceeds available height, scrolling is constrained to local regions (sheet/panel/list) rather than entire page canvas.

## Responsive Behavior

- Scope of no-page-scroll requirement:
  - Must fit viewport without page scroll: /upload, /scan, /view, /compare, /match.
  - May scroll as document pages: /profile, /login, /, /docs.
- Core tool routes use nav-aware available height (based on --nav-h) and flex min-h-0 containers so media and controls stay in-window.
- On mobile, controls collapse into compact toolbars/sheets while preserving immediate access to the primary action.
- On desktop, media and controls can split into columns, but primary actions remain visible without vertical page scrolling.
- Modal/sheet scrolling is allowed internally; page-level scrolling on tool routes is not.

## Accessibility Requirements

- WCAG AA minimum for all refreshed interfaces.
- Contrast: at least 4.5:1 for body text and 3:1 for large text/icons.
- Full keyboard navigation and operability across nav, toolbars, media controls, and modals/sheets.
- Visible, consistent focus indicators across all interactive controls.
- Screen-reader clarity for page landmarks, action labels, status messaging, and step/workspace context.
- Respect reduced-motion preferences by limiting animation to meaningful state transitions.

## Out of Scope

- Any change to application behavior, data contracts, or processing algorithms (pose, ORB, matching/homography).
- Changes that break existing component APIs.
- Rewriting route logic or storage/auth flows.
- Rebranding, new logo/identity system, or broad marketing-site redesign.
- Forcing no-scroll behavior on /profile, /login, /, or /docs.
