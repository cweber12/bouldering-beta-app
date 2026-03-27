/**
 * Helpers for converting between browser ImageData and OpenCV Mat objects.
 *
 * All Mat cleanup in this codebase MUST go through matDelete() — never call
 * mat.delete() directly. This keeps cleanup centralised and easy to audit.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mat = any;

/**
 * Crop a rectangular region from an ImageData and return a new ImageData.
 *
 * Pixels outside the source bounds are left as transparent black (the
 * Uint8ClampedArray is zero-initialised). Compatible with jsdom test
 * environments — returns a plain object cast as ImageData rather than calling
 * the ImageData constructor.
 */
export function cropImageData(
  src: ImageData,
  box: { x: number; y: number; width: number; height: number },
): ImageData {
  const dst = new Uint8ClampedArray(box.width * box.height * 4);
  for (let row = 0; row < box.height; row++) {
    const srcRow = box.y + row;
    if (srcRow < 0 || srcRow >= src.height) continue;
    for (let col = 0; col < box.width; col++) {
      const srcCol = box.x + col;
      if (srcCol < 0 || srcCol >= src.width) continue;
      const srcIdx = (srcRow * src.width + srcCol) * 4;
      const dstIdx = (row * box.width + col) * 4;
      dst[dstIdx]     = src.data[srcIdx];
      dst[dstIdx + 1] = src.data[srcIdx + 1];
      dst[dstIdx + 2] = src.data[srcIdx + 2];
      dst[dstIdx + 3] = src.data[srcIdx + 3];
    }
  }
  return { data: dst, width: box.width, height: box.height, colorSpace: "srgb" } as unknown as ImageData;
}

/**
 * Convert a browser ImageData object to an OpenCV RGBA Mat.
 *
 * Caller is responsible for calling matDelete() on the returned Mat when done.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function imageDataToMat(cv: CV, imageData: ImageData): Mat {
  // TODO: implement in a later commit when ORB features are built out.
  throw new Error("imageDataToMat: not yet implemented");
}

/**
 * Safely delete an OpenCV Mat, suppressing errors if it has already been freed.
 * Pass null/undefined safely — this is a no-op in that case.
 */
export function matDelete(mat: Mat | null | undefined): void {
  if (!mat) return;
  try {
    mat.delete();
  } catch {
    // Already deleted — nothing to do.
  }
}
