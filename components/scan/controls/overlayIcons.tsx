"use client";

/**
 * Glyphs for the Detection Preview control bar.
 *
 * `HandIcon` marks the **Holds** editor (a hand emblem — holds are where the
 * climber's hands and feet grip the wall). `ClimberIcon` marks the **Climber**
 * overlay panel (a person, the figure the Skeleton traces). Both are filled
 * paths inheriting `currentColor` so they pick up the toolbar button's text
 * colour / hover / active states.
 */

interface IconProps {
  className?: string;
}

/** Hand emblem — the Holds editor glyph. */
export function HandIcon({ className = "h-4 w-4 shrink-0" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M16 1c-8.284 0-15 6.716-15 15s6.716 15 15 15 15-6.716 15-15-6.715-15-15-15zM16 4.75c6.213 0 11.25 5.037 11.25 11.25s-5.037 11.25-11.25 11.25-11.25-5.037-11.25-11.25c0.001-6.214 5.038-11.25 11.25-11.25zM23.5 11.313c0 0-1.265 2.666-1.608 4.031-0.448 1.785 0.184 2.75-0.467 4.48-0.282 0.507 0.605 1.302 0.585 1.765-0.017 0.391-1.547 1.221-1.884 1.388s-2.333 0.913-2.905 0.915c-0.605 0.003-0.58-1.329-1.605-1.33-1.504-0.002-5.428-1.149-5.428-1.149-0.594-0.153-1.687-0.063-1.687-0.726s0.777-1.148 1.467-1.15l2.72 0.238c0.66-0.042 1.353-0.428 1.374-1.293-0.011-1.279-0.137-2.261-0.787-3.3l-2.521-3.933c-0.151-0.313-0.187-0.847 0.249-1.085s0.931 0.116 1.1 0.424l2.816 3.831c0.3 0.28 0.835 0.333 0.79-0.262l-1.243-5.7c-0.078-0.405 0.128-0.896 0.597-0.896 0.615 0 0.994 0.234 0.982 0.607l1.367 5.624c0.107 0.274 0.485 0.237 0.587-0.016l0.39-5.47c0.020-0.174 0.248-0.478 0.685-0.415s0.689 0.531 0.642 0.712l-0.126 5.404c0.089 0.479 0.465 0.549 0.758 0.282l1.913-3.421c0.116-0.287 0.572-0.347 0.834-0.233 0.244 0.162 0.404 0.376 0.404 0.678v0z" />
    </svg>
  );
}

/** Person figure — the Climber overlay glyph. */
export function ClimberIcon({ className = "h-4 w-4 shrink-0" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.9 2.999A1.9 1.9 0 1 1 12 1.1a1.9 1.9 0 0 1 1.9 1.899zM13.544 6h-3.088a1.855 1.855 0 0 0-1.8 1.405l-1.662 6.652a.667.667 0 0 0 .14.573.873.873 0 0 0 .665.33.718.718 0 0 0 .653-.445L10 9.1V13l-.922 9.219a.71.71 0 0 0 .707.781h.074a.69.69 0 0 0 .678-.563L12 14.583l1.463 7.854a.69.69 0 0 0 .678.563h.074a.71.71 0 0 0 .707-.781L14 13V9.1l1.548 5.415a.718.718 0 0 0 .653.444.873.873 0 0 0 .665-.329.667.667 0 0 0 .14-.573l-1.662-6.652A1.855 1.855 0 0 0 13.544 6z" />
    </svg>
  );
}
