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
 * | CTA button          | accent         | fg              | —            | accent-hover bg       |
 * | Secondary button    | card           | fg-secondary    | edge         | edge-hover, fg        |
 * | Navigation bar      | surface-alt/95 | fg-muted        | edge         | fg-light, fg          |
 * | Nav active tab      | —              | fg              | accent       | —                     |
 * | Modal               | card           | fg              | —            | —                     |
 * | Progress bar track  | inset          | —               | —            | —                     |
 * | Progress bar fill   | accent         | —               | —            | —                     |
 * | Badge / tag         | inset          | fg-light        | —            | —                     |
 * | Label               | —              | fg-secondary    | —            | —                     |
 * | Heading             | —              | fg              | —            | —                     |
 * | Body text           | —              | fg-secondary    | —            | —                     |
 * | Muted text          | —              | fg-muted        | —            | —                     |
 * | Placeholder         | —              | fg-placeholder  | —            | —                     |
 *
 * ## Palette
 *
 * Base: #F3F3E0 (cream), #27548A (blue), #183B4E (navy), #DDA853 (amber)
 * Source: https://colorhunt.co/palette/f3f3e027548a183b4edda853
 */

// ─── Raw palette hex values ──────────────────────────────
// Use these for canvas drawing, chart rendering, or anywhere
// CSS custom properties are not available.
export const palette = {
  cream: "#F3F3E0",
  blue: "#27548A",
  navy: "#183B4E",
  amber: "#DDA853",
} as const;

// ─── Dark theme (active) ─────────────────────────────────
export const dark = {
  surface: "#183B4E",
  surfaceAlt: "#0e2535",
  card: "#1a3a52",
  inset: "#132d3f",
  fg: "#F3F3E0",
  fgSecondary: "#8ba8c4",
  fgMuted: "#6889a8",
  fgLight: "#c4d4e0",
  fgPlaceholder: "#4a7099",
  edge: "#2a4a6b",
  edgeHover: "#3d6089",
  accent: "#DDA853",
  accentHover: "#c4913a",
  primary: "#27548A",
  success: "#3daa78",
} as const;

// ─── Light theme (future) ────────────────────────────────
// Uncomment the `.theme-light` block in globals.css to activate.
export const light = {
  surface: "#f8f7f0",
  surfaceAlt: "#F3F3E0",
  card: "#ffffff",
  inset: "#edecd8",
  fg: "#183B4E",
  fgSecondary: "#4a6170",
  fgMuted: "#7a8e9a",
  fgLight: "#5a7080",
  fgPlaceholder: "#a0b0b8",
  edge: "#c8cdd0",
  edgeHover: "#a0aab0",
  accent: "#DDA853",
  accentHover: "#c4913a",
  primary: "#27548A",
  success: "#3daa78",
} as const;
