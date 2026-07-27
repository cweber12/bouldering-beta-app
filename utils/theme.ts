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
  surface: "#1a1815",
  surfaceAlt: "#15130f",
  card: "#211e1a", // wet-basalt warm charcoal — no tint
  inset: "#121008",
  fg: "#ece7e0",
  fgSecondary: "#b5aea3",
  fgMuted: "#968f83",
  fgLight: "#c9c2b6",
  fgInverse: "#161310", // dark ink on bright fills
  edge: "#37322b",
  edgeHover: "#57503f",
  accent: "#7bb695", // muted pine, bright tint
  accentHover: "#8fc6a6",
  success: "#52c68f",
  danger: "#e28579",
  caution: "#d8a648",
  send: "#52c68f",
  sendSurface: "#15352a",
  attempt: "#d8a648",
  attemptSurface: "#2e2310",
  handHold: "#39b1d1", // Hand Hold ring — mirror of HOLD_RING_COLOR.hand
  footHold: "#f6850c", // Foot Hold ring — mirror of HOLD_RING_COLOR.foot
  // Dev detection-eval-harness crop overlay (canvas-only, theme-independent —
  // drawn over the video frame like the Hold rings above).
  cropRegion: "#38bdf8", // Adaptive Crop search region (detected)
  cropLandmark: "#c084fc", // tight landmark box (deriveClimberCrop)
  cropMiss: "#f87171", // search region on a miss (no pose found)
  // Run review overlay poses — the two skeletons compared on the frame stage.
  // Displacement reads as the gap between them, so the pair is chosen for
  // contrast against each other and the crop colours above.
  truthPose: "#a3e635", // the Ground Truth reference
  runPose: "#f472b6", // the pose the run actually held
} as const;

// ─── Light theme canvas values ───────────────────────────────
export const light = {
  surface: "#efece7", // chalk page
  surfaceAlt: "#e6e2db",
  card: "#fdfbf8", // near-white panel
  inset: "#e2ded6",
  fg: "#1c1915", // near-black warm text
  fgSecondary: "#443e36",
  fgMuted: "#5b544b",
  fgLight: "#514b42",
  fgInverse: "#ffffff", // white on deep fills
  edge: "#c9c4bb",
  edgeHover: "#8f887c",
  accent: "#2c5942", // deep pine
  accentHover: "#204534",
  success: "#116e4b",
  danger: "#a8372a",
  caution: "#82550f",
  send: "#116e4b",
  sendSurface: "#d9e9df",
  attempt: "#82550f",
  attemptSurface: "#f2e7cd",
  handHold: "#39b1d1", // same colours (overlay drawn on a photo, theme-independent)
  footHold: "#f6850c",
  cropRegion: "#38bdf8", // same colours (dev harness overlay, theme-independent)
  cropLandmark: "#c084fc",
  cropMiss: "#f87171",
  truthPose: "#a3e635",
  runPose: "#f472b6",
} as const;

export type Theme = typeof dark;
