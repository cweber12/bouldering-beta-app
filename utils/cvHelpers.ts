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
