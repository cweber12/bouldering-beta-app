Audit the codebase for theme rule violations. Work through each check and report every finding with file:line and the correct fix.

## Check 1 — Raw Tailwind palette classes in TSX/CSS

Grep all `.tsx`, `.ts`, and `.css` files (excluding `node_modules`, `.next`, `coverage`, `workers`) for these patterns and map each to the correct semantic token:

| Forbidden pattern | Correct semantic token |
|---|---|
| `red-[0-9]`, `rose-[0-9]` | `text-danger` / `bg-danger-surface` / `border-danger-border` |
| `amber-[0-9]`, `yellow-[0-9]` | `text-caution` / `bg-caution-surface` / `border-caution-border` |
| `emerald-[0-9]`, `green-[0-9]` | `text-send` / `bg-send` / `bg-send-surface` (unless in a data-viz or chart context) |
| `black/[0-9]` in overlays | `bg-surface/70 backdrop-blur-sm` |
| `bg-black`, `text-white` where surface tokens apply | `bg-surface`, `text-fg` |

## Check 2 — Canvas drawing code

Inspect `pipeline/skeletonOverlay.ts`, `pipeline/poseVideoRenderer.ts`, `pipeline/multiPoseVideoRenderer.ts`, and any other files that call `ctx.fillStyle`, `ctx.strokeStyle`, or `ctx.fillText`. Verify they read colors from `utils/theme.ts` (`dark` / `light` objects) rather than hardcoded hex strings or raw color names.

## Check 3 — globals.css ↔ utils/theme.ts sync

Compare the `dark` and `light` token values in `utils/theme.ts` with the corresponding CSS custom properties in `app/globals.css`. Report any mismatch (a token present in one but not the other, or different values).

## Report

For each violation: file path (as a link), line number, what was found, and what it should be changed to.
