/**
 * Adaptive-contrast maths for the Skeleton & Holds overlays.
 *
 * The overlay palette is fixed by meaning — cyan is a Hand Hold, orange is a
 * Foot Hold (ADR 0012), the anatomical Skeleton keeps its limb identities — but
 * a colour can lose contrast against the exact wall pixels it is drawn on. This
 * module nudges each colour's **lightness only** just far enough to become
 * legible against the sampled backdrop, never touching hue (so no colour ever
 * changes what it *means*) and never reducing saturation below the authored
 * value (saturation is only ever raised, to rescue a hue that a lightness push
 * toward an extreme would wash out).
 *
 * Framework-agnostic: no React, no OpenCV, no canvas. Pure functions only, so
 * the whole model unit-tests at its highest seam. The DOM wrapper that samples a
 * backdrop into an {@link ImageData} lives in the hook layer; only the pure
 * pixel-math ({@link computeLumaStats}) lives here.
 *
 * The same Rec. 709 relative-luminance formula is used for both the backdrop and
 * the overlay colours so the two scales match, and the WCAG graphical-object
 * contrast bar (3:1) is the legibility target.
 */

// ---------------------------------------------------------------------------
// Tuning constants — top-of-file so adjusting aggressiveness against real routes
// is a one-line change (no logic edits).
// ---------------------------------------------------------------------------

/** Contrast ratio a colour must clear against the backdrop band. WCAG's bar for
 *  graphical objects / UI components is 3:1. */
export const TARGET_CONTRAST_RATIO = 3;

/** Band multiplier: a colour must beat the near edge of `mean ± k·stdDev`, so a
 *  high-variance (busy) wall demands a firmer shift than a flat one. */
export const BAND_K = 1.0;

/** WCAG contrast offset: ratio = (Lhi + OFFSET) / (Llo + OFFSET). */
const CONTRAST_OFFSET = 0.05;

/** How aggressively saturation is rescued as a colour is pushed toward black or
 *  white. Fraction of the remaining head-room (1 − s) added at full extremity. */
const SAT_RESCUE = 0.6;

/** Lightness beyond which (toward 1 or 0) vividness rescue starts ramping in. */
const EXTREME_L = 0.85;

// ---------------------------------------------------------------------------
// Value objects
// ---------------------------------------------------------------------------

/** Backdrop luminance summary in [0, 1] (Rec. 709 relative luminance). */
export interface LumaStats {
  meanLuma: number;
  stdLuma: number;
}

/**
 * A per-surface contrast model: the backdrop luminance band plus the tuning
 * constants. One object serves every colour identity from a single backdrop
 * sample — {@link adaptColor} does the per-colour work.
 */
export interface ContrastAdjust {
  meanLuma: number;
  stdLuma: number;
  target: number;
  k: number;
}

// ---------------------------------------------------------------------------
// Colour helpers (self-contained so the module stays pure & independent).
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Rec. 709 relative luminance on normalised [0, 1] channels. Same formula for
 *  the backdrop and for overlay colours, so both live on one scale. */
function relLuma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Parse `#rgb` / `#rrggbb` / `rgb(...)` / `rgba(...)` to 0-255 RGB. Falls back
 *  to mid-grey for anything unrecognised. */
function parseRgb(css: string): { r: number; g: number; b: number } {
  const s = css.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgb = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  return { r: 128, g: 128, b: 128 };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** HSL → normalised [0, 1] RGB. */
function hslToRgb01(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

function hslToCss(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb01(h, s, l);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

/** WCAG-style contrast ratio between two relative luminances. */
function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + CONTRAST_OFFSET) / (lo + CONTRAST_OFFSET);
}

// ---------------------------------------------------------------------------
// Pure pixel-math — the testable half of the backdrop sampler.
// ---------------------------------------------------------------------------

/**
 * Mean and standard deviation of Rec. 709 relative luminance across an
 * {@link ImageData}. The DOM half (drawing a photo / crop rect to a small
 * offscreen canvas and reading it back) lives in the hook layer; this stays pure
 * so it unit-tests with plain-object `ImageData` casts.
 */
export function computeLumaStats(img: ImageData): LumaStats {
  const d = img.data;
  const n = img.width * img.height;
  if (n === 0) return { meanLuma: 0, stdLuma: 0 };
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = relLuma(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    sum += l;
    sumSq += l * l;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return { meanLuma: mean, stdLuma: Math.sqrt(variance) };
}

/**
 * Build a {@link ContrastAdjust} from backdrop stats plus optional overrides for
 * the target ratio and band multiplier (defaulting to the module constants).
 */
export function computeContrastAdjust(
  stats: LumaStats,
  opts?: { target?: number; k?: number },
): ContrastAdjust {
  return {
    meanLuma: clamp01(stats.meanLuma),
    stdLuma: Math.max(0, stats.stdLuma),
    target: opts?.target ?? TARGET_CONTRAST_RATIO,
    k: opts?.k ?? BAND_K,
  };
}

// ---------------------------------------------------------------------------
// Per-colour adaptation
// ---------------------------------------------------------------------------

/** The absolute lightness shift and final saturation to apply to one colour. */
interface Adjustment {
  /** Signed lightness shift in [-1, 1] applied to the authored lightness. */
  dl: number;
  /** Final saturation — always ≥ the authored value (rescue only raises it). */
  s: number;
}

/**
 * Bisect for the HSL lightness (within `[loL, hiL]`) whose colour reaches
 * `targetLuma`. Relative luminance is monotonic in L for a fixed hue/saturation,
 * so a plain binary search converges.
 */
function solveLForLuma(
  h: number,
  s: number,
  targetLuma: number,
  loL: number,
  hiL: number,
): number {
  const want = clamp01(targetLuma);
  let lo = loL;
  let hi = hiL;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const [r, g, b] = hslToRgb01(h, s, mid);
    if (relLuma(r, g, b) < want) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Work out how to nudge one colour so it clears the target contrast against the
 * backdrop band. Returns a zero adjustment when the colour already passes.
 *
 * The colour may move lighter (to beat the band's light edge, `mean + k·std`) or
 * darker (to beat the dark edge, `mean − k·std`); the direction requiring the
 * smaller lightness move wins, which naturally biases away from the extremes
 * that would wash the hue out.
 */
function computeAdjustment(css: string, adjust: ContrastAdjust): Adjustment {
  const { r, g, b } = parseRgb(css);
  const [h, s, l] = rgbToHsl(r, g, b);
  const { target } = adjust;

  const light = clamp01(adjust.meanLuma + adjust.k * adjust.stdLuma);
  const dark = clamp01(adjust.meanLuma - adjust.k * adjust.stdLuma);

  const [cr, cg, cb] = hslToRgb01(h, s, l);
  const cur = relLuma(cr, cg, cb);

  const clears = (lc: number): boolean => {
    if (lc >= light) return contrastRatio(lc, light) >= target - 1e-9;
    if (lc <= dark) return contrastRatio(lc, dark) >= target - 1e-9;
    return false; // inside the band → failing on both sides
  };
  if (clears(cur)) return { dl: 0, s };

  // Luminance needed to clear the target on each side of the band.
  const wantUp = target * (light + CONTRAST_OFFSET) - CONTRAST_OFFSET;
  const wantDown = (dark + CONTRAST_OFFSET) / target - CONTRAST_OFFSET;

  const upReachable = wantUp <= 1 + 1e-9;
  const downReachable = wantDown >= -1e-9;

  // Pick the direction requiring the smaller lightness move (a preliminary solve
  // at the authored saturation), biasing away from the washed-out extremes.
  let targetLuma: number;
  if (upReachable && downReachable) {
    const lUp = solveLForLuma(h, s, wantUp, l, 1);
    const lDown = solveLForLuma(h, s, wantDown, 0, l);
    targetLuma = lUp - l <= l - lDown ? wantUp : wantDown;
  } else if (upReachable) {
    targetLuma = wantUp;
  } else if (downReachable) {
    targetLuma = wantDown;
  } else {
    // Neither side reachable — go to the nearest extreme.
    return { dl: (cur >= light ? 1 : 0) - l, s };
  }

  // Vividness rescue: the closer the final lightness sits to black/white, the
  // more the hue would grey out — add saturation to keep it recognisable. Sized
  // from a preliminary lightness estimate, then the lightness is re-solved with
  // the boosted saturation so the target luminance is still hit exactly. Never
  // subtracts, so the authored saturation is always a floor.
  const prelimL = solveLForLuma(h, s, targetLuma, 0, 1);
  const extremity =
    prelimL > 0.5
      ? Math.max(0, (prelimL - EXTREME_L) / (1 - EXTREME_L))
      : Math.max(0, ((1 - EXTREME_L) - prelimL) / (1 - EXTREME_L));
  const sFinal = clamp01(s + (extremity > 0 ? (1 - s) * extremity * SAT_RESCUE : 0));

  const finalL = solveLForLuma(h, sFinal, targetLuma, 0, 1);
  return { dl: finalL - l, s: sFinal };
}

/** Apply a computed {@link Adjustment} to a colour, preserving hue. */
function applyAdjustment(css: string, dl: number, s: number): string {
  const { r, g, b } = parseRgb(css);
  const [h, , l] = rgbToHsl(r, g, b);
  return hslToCss(h, clamp01(s), clamp01(l + dl));
}

/**
 * Return `css` nudged (lightness only, hue-locked) so it clears the target
 * contrast against `adjust`'s backdrop band. When `adjust` is undefined, or the
 * colour already reads fine, the input is returned **unchanged** — the feature
 * is additive and can never regress the authored palette.
 */
export function adaptColor(css: string, adjust?: ContrastAdjust | null): string {
  if (!adjust) return css;
  const { dl, s } = computeAdjustment(css, adjust);
  if (dl === 0) return css;
  return applyAdjustment(css, dl, s);
}

/**
 * Adapt the two endpoints of an anatomical gradient **together**: both are
 * shifted by a single shared lightness delta (the larger of the two colours'
 * required moves) so the ramp slides as one identity and can never compress or
 * invert. Saturation rescue is still applied per endpoint. Returns the pair
 * unchanged when `adjust` is undefined.
 */
export function adaptRamp(
  startCss: string,
  endCss: string,
  adjust?: ContrastAdjust | null,
): [string, string] {
  if (!adjust) return [startCss, endCss];
  const a = computeAdjustment(startCss, adjust);
  const b = computeAdjustment(endCss, adjust);
  // Shift both endpoints by the single larger delta so the ramp slides as one
  // identity and can never compress or invert; saturation rescue stays per-end.
  const dl = Math.abs(a.dl) >= Math.abs(b.dl) ? a.dl : b.dl;
  return [
    applyAdjustment(startCss, dl, a.s),
    applyAdjustment(endCss, dl, b.s),
  ];
}
