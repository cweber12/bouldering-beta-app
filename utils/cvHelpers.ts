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

  // Compute the overlapping region between the box and source bounds.
  const srcStartCol = Math.max(0, box.x);
  const srcEndCol   = Math.min(src.width, box.x + box.width);
  const srcStartRow = Math.max(0, box.y);
  const srcEndRow   = Math.min(src.height, box.y + box.height);

  if (srcStartCol < srcEndCol && srcStartRow < srcEndRow) {
    const dstColOffset = srcStartCol - box.x;
    const bytesPerCopy = (srcEndCol - srcStartCol) * 4;
    for (let srcRow = srcStartRow; srcRow < srcEndRow; srcRow++) {
      const dstRow = srcRow - box.y;
      const srcIdx = (srcRow * src.width + srcStartCol) * 4;
      const dstIdx = (dstRow * box.width + dstColOffset) * 4;
      dst.set(src.data.subarray(srcIdx, srcIdx + bytesPerCopy), dstIdx);
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
