/**
 * Central color theme definitions for the application.
 *
 * ## How colors are connected
 *
 * All Tailwind utility colors and inline `style={{}}` references share the same
 * CSS custom properties, defined once in `globals.css` via the `@theme inline`
 * block. Changing a value there updates every component automatically.
 *
 * | CSS variable           | Tailwind class      | Inline style                   |
 * |------------------------|---------------------|--------------------------------|
 * | `--color-surface`      | `bg-surface`        | `var(--color-surface)`         |
 * | `--color-card`         | `bg-card`           | `var(--color-card)`            |
 * | `--color-fg`           | `text-fg`           | `var(--color-fg)`              |
 * | `--color-accent`       | `bg-accent`         | `var(--color-accent)`          |
 * | `--color-edge`         | `border-edge`       | `var(--color-edge)`            |
 *
 * Opacity modifiers work naturally: `bg-accent/10`, `border-accent/60`.
 *
 * ## DOM element → token mapping
 *
 * | Element type        | Background     | Text            | Border       | Hover                 |
 * |---------------------|----------------|-----------------|--------------|-----------------------|
 * | Page background     | surface        | fg              | —            | —                     |
 * | Darker page bg      | surface-alt    | fg              | —            | —                     |
 * | Content card        | card           | fg-secondary    | edge         | edge-hover            |
 * | Clickable card      | primary        | fg              | edge         | accent/60 border      |
 * | Input / inset area  | inset          | fg              | edge         | accent/60 focus       |
 * | Dropdown list       | card           | fg-light        | edge         | inset bg on hover     |
 * | CTA button          | accent         | surface         | —            | accent-hover bg       |
 * | Secondary button    | card           | fg-secondary    | edge         | edge-hover, fg        |
 * | Navigation bar      | surface-alt/90 | fg-muted        | edge         | fg-light, fg          |
 * | Nav active tab      | card/60        | fg              | —            | —                     |
 * | Active tab underline| —              | —               | accent       | —                     |
 * | Modal               | card           | fg              | —            | —                     |
 * | Progress bar track  | inset          | —               | —            | —                     |
 * | Progress bar fill   | accent         | —               | —            | —                     |
 * | Badge / tag         | inset          | fg-light        | —            | —                     |
 * | Run-type chip       | send / attempt | fg-inverse      | —            | —                     |
 * | Send badge          | send-surface   | send            | —            | —                     |
 * | Attempt badge       | attempt-surface| attempt         | —            | —                     |
 * | Error message       | danger-surface | danger          | danger-border| —                     |
 * | Warning message     | caution-surface| caution         | caution-border| —                    |
 * | Success message     | send-surface   | send            | —            | —                     |
 * | Heading             | —              | fg              | —            | —                     |
 * | Body text           | —              | fg-secondary    | —            | —                     |
 * | Muted text          | —              | fg-muted        | —            | —                     |
 * | Placeholder         | —              | fg-placeholder  | —            | —                     |
 */

// ─── Dark theme canvas values ────────────────────────────────
// Used for canvas drawing, map pins, and anywhere CSS custom
// properties are not available. Keep in sync with globals.css.
export const dark = {
  surface:        "#161a1e",
  surfaceAlt:     "#111417",
  card:           "#1e2228",
  inset:          "#131619",
  fg:             "#e4e2dd",
  fgSecondary:    "#9ca3ab",
  fgMuted:        "#636b75",
  fgLight:        "#b3b9c1",
  fgInverse:      "#f9fafb",
  edge:           "#282e36",
  edgeHover:      "#3a424e",
  accent:         "#22c55e",
  accentHover:    "#16a34a",
  success:        "#22c55e",
  danger:         "#f87171",
  caution:        "#fbbf24",
  send:           "#34d399",
  sendSurface:    "#0d3d24",
  attempt:        "#fbbf24",
  attemptSurface: "#3d2100",
} as const;

// ─── Light theme canvas values ───────────────────────────────
export const light = {
  surface:        "#f3f2ee",
  surfaceAlt:     "#eae9e4",
  card:           "#ffffff",
  inset:          "#e5e4de",
  fg:             "#1a1d21",
  fgSecondary:    "#4a5060",
  fgMuted:        "#7a8290",
  fgLight:        "#5a6270",
  fgInverse:      "#ffffff",
  edge:           "#d0d3d8",
  edgeHover:      "#a8aeb6",
  accent:         "#16a34a",
  accentHover:    "#15803d",
  success:        "#16a34a",
  danger:         "#dc2626",
  caution:        "#b45309",
  send:           "#059669",
  sendSurface:    "#d1fae5",
  attempt:        "#b45309",
  attemptSurface: "#fef3c7",
} as const;

export type Theme = typeof dark;

