/**
 * Hard cap on the number of pixels rasterised from a user-supplied image into a
 * canvas / ImageData. Guards the ORB pipeline and the OpenCV WASM heap against
 * gigapixel "decompression-bomb" inputs and oversized phone photos. 24 MP clears
 * every current phone camera (12–48 MP images downscale to fit) while bounding
 * the memory a single decode can allocate downstream.
 */
export const MAX_DECODE_PIXELS = 24_000_000;

export interface CappedDimensions {
  width: number;
  height: number;
  /** Linear scale applied to the native dimensions to reach width/height (≤ 1). */
  scale: number;
}

/**
 * Clamp `(width, height)` so `width * height` does not exceed `maxPixels`,
 * preserving aspect ratio. Returns the input unchanged (scale 1) when it already
 * fits. Used at image-decode time so we never rasterise an oversized image.
 */
export function capToPixelBudget(
  width: number,
  height: number,
  maxPixels = MAX_DECODE_PIXELS,
): CappedDimensions {
  const pixels = width * height;
  if (pixels <= maxPixels || pixels === 0) return { width, height, scale: 1 };
  const scale = Math.sqrt(maxPixels / pixels);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/**
 * Resize and JPEG-compress a File to a base64 data URL.
 * Maximum dimensions: 1280×960, quality: 82%.
 */
export async function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_W = 1280,
        MAX_H = 960;
      const scale = Math.min(1, MAX_W / img.naturalWidth, MAX_H / img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load failed"));
    };
    img.src = url;
  });
}

/** A WebP-encoded image plus the pixel dimensions it was encoded at. */
export interface WebpEncodeResult {
  /** `data:image/webp;base64,…` */
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Longest edge, in pixels, an image embedded in a landing replay clip is
 * encoded at. The hero draws it letterboxed into a stage under ~900 px tall, so
 * 960 is already above what any visitor sees — and the two embedded images are
 * where a checked-in clip's weight actually is.
 */
export const REPLAY_WEBP_MAX_EDGE = 960;

/**
 * WebP quality for those images. The Route Photo is the frame the whole clip
 * resolves onto, so this is the one payload lever with a visible cost; 0.6 is
 * where the wall still reads as a photograph rather than as artefacts.
 */
export const REPLAY_WEBP_QUALITY = 0.6;

/**
 * Resize and WebP-compress a File to a base64 data URL, returning the encoded
 * dimensions alongside it.
 *
 * Used by the landing-clip authoring route, which embeds the Route Photo
 * directly in the exported replay item — WebP at a capped longest edge keeps a
 * checked-in playlist to a sane size while staying legible as a hero backdrop.
 * Aspect ratio is preserved, so normalized photo coordinates computed at match
 * resolution map onto the encoded image unchanged.
 */
export async function compressImageToWebpDataUrl(
  file: File,
  maxEdge = REPLAY_WEBP_MAX_EDGE,
  quality = REPLAY_WEBP_QUALITY,
): Promise<WebpEncodeResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({
        dataUrl: canvas.toDataURL("image/webp", quality),
        width: canvas.width,
        height: canvas.height,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load failed"));
    };
    img.src = url;
  });
}

/**
 * Convert a data URL string to a File object.
 */
export async function dataUrlToFile(dataUrl: string, filename = "route-image.jpg"): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type });
}
