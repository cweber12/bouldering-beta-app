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
  surface: "#161a1e",
  surfaceAlt: "#111417",
  card: "#1b2130", // subtle teal-grey tint — scanner identity
  inset: "#0f1318",
  fg: "#e8e4de",
  fgSecondary: "#99a2ac",
  fgMuted: "#717d8a",
  fgLight: "#b0bac5",
  fgInverse: "#f9fafb",
  edge: "#252e3a",
  edgeHover: "#3a4557",
  accent: "#22c55e",
  accentHover: "#16a34a",
  success: "#22c55e",
  danger: "#f87171",
  caution: "#fbbf24",
  send: "#34d399",
  sendSurface: "#0c3d22",
  attempt: "#fbbf24",
  attemptSurface: "#3d2200",
  handHold: "#39b1d1", // Hand Hold ring — mirror of HOLD_RING_COLOR.hand
  footHold: "#f6850c", // Foot Hold ring — mirror of HOLD_RING_COLOR.foot
} as const;

// ─── Light theme canvas values ───────────────────────────────
export const light = {
  surface: "#efece7", // warm stone
  surfaceAlt: "#e5e1db",
  card: "#fefcf9", // warm near-white
  inset: "#ddd9d2",
  fg: "#0f0c0a", // near-black body text
  fgSecondary: "#211c17", // dark secondary copy
  fgMuted: "#332d27", // readable muted copy
  fgLight: "#4d463f", // supportive but legible text
  fgInverse: "#ffffff",
  edge: "#c8c3bc", // warm stone-300
  edgeHover: "#a29d96", // stone-400
  accent: "#14532d", // green-900
  accentHover: "#052e16", // deep green hover
  success: "#14532d",
  danger: "#b91c1c", // red-700
  caution: "#92400e", // amber-800
  send: "#047857", // emerald-700
  sendSurface: "#d1fae5", // emerald-100
  attempt: "#92400e", // amber-800
  attemptSurface: "#fef3c7", // amber-100
  handHold: "#39b1d1", // same colours (overlay drawn on a photo, theme-independent)
  footHold: "#f6850c",
} as const;

export type Theme = typeof dark;
