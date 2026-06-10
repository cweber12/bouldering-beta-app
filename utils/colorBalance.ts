/**
 * Adaptive gray-world white balance for the pose-detector input.
 *
 * Some videos arrive with a strong global colour cast — most notably HDR /
 * BT.2020 (HLG / PQ) clips, which Chromium mis-converts to a green, desaturated
 * look when a `<video>` frame is drawn onto an sRGB 2D canvas. MediaPipe's
 * RGB-trained person detector fails on such frames, returning zero poses even
 * when a climber fills the frame. Re-balancing the channels toward neutral
 * restores plausible RGB so the detector can lock on again.
 *
 * The correction self-gates: frames whose channel means are already near
 * neutral are left untouched, so ordinary footage (including legitimately
 * tinted scenes within the threshold) is never altered. This is a pure pixel
 * operation — no OpenCV, no React — and is therefore unit-testable in jsdom.
 */

export interface ChannelMeans {
  r: number;
  g: number;
  b: number;
}

/**
 * Mean of each RGB channel across an RGBA pixel buffer. `pixelStride`
 * subsamples (every Nth pixel) so the estimate stays cheap on large frames;
 * means are insensitive to subsampling.
 */
export function channelMeans(data: Uint8ClampedArray, pixelStride = 16): ChannelMeans {
  const step = Math.max(1, Math.floor(pixelStride)) * 4;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i + 2 < data.length; i += step) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * Ratio of the brightest channel mean to the dimmest. 1 = perfectly neutral;
 * a strong green cast pushes this well above 1.
 */
export function castRatio(m: ChannelMeans): number {
  const max = Math.max(m.r, m.g, m.b);
  const min = Math.min(m.r, m.g, m.b);
  if (min <= 0) return max <= 0 ? 1 : Infinity;
  return max / min;
}

export interface NeutralizeOptions {
  /** Minimum {@link castRatio} before any correction is applied. Default 1.35. */
  threshold?: number;
  /** Per-channel gain is clamped to [1/maxGain, maxGain]. Default 2.0. */
  maxGain?: number;
  /**
   * Frames whose darkest channel mean is below this are treated as near-black
   * (no reliable colour to balance) and skipped. Default 8.
   */
  blackFloor?: number;
}

/**
 * In-place gray-world white balance. Scales each channel so its mean moves
 * toward the overall gray mean, neutralising a global colour cast.
 *
 * Applies only when the frame's {@link castRatio} exceeds `threshold`; returns
 * `true` when a correction was made, `false` when the frame was left untouched.
 * Per-channel gain is clamped to avoid blowing out a near-dead channel.
 */
export function neutralizeColorCast(
  data: Uint8ClampedArray,
  opts: NeutralizeOptions = {},
): boolean {
  const threshold = opts.threshold ?? 1.35;
  const maxGain = opts.maxGain ?? 2.0;
  const blackFloor = opts.blackFloor ?? 8;

  const m = channelMeans(data);
  if (Math.min(m.r, m.g, m.b) < blackFloor) return false;
  if (castRatio(m) < threshold) return false;

  const gray = (m.r + m.g + m.b) / 3;
  const clamp = (gain: number) => Math.min(maxGain, Math.max(1 / maxGain, gain));
  const gr = clamp(gray / m.r);
  const gg = clamp(gray / m.g);
  const gb = clamp(gray / m.b);

  for (let i = 0; i + 2 < data.length; i += 4) {
    // Uint8ClampedArray assignment clamps to [0, 255] and rounds.
    data[i] = data[i] * gr;
    data[i + 1] = data[i + 1] * gg;
    data[i + 2] = data[i + 2] * gb;
  }
  return true;
}
