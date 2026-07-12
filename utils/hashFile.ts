/**
 * Content hashing for diagnostics record keys.
 *
 * Diagnostics records are keyed by the SHA-256 content hash of the source video
 * and route photo, so re-using the same file across scans/matches collapses to a
 * stable key (and trend analysis needs no join back to pose/ORB artifacts).
 *
 * Framework-agnostic — no React imports. Uses the Web Crypto SubtleCrypto API
 * available in browsers and modern Node.
 */

/** Per-File promise cache so repeated hashing of the same File is free. */
const cache = new WeakMap<File, Promise<string>>();

/**
 * SHA-256 the bytes of a File and return the lowercase hex digest. The result is
 * cached per File instance, so calling this repeatedly with the same File (e.g.
 * once at scan time and again at match time) hashes the bytes only once.
 */
export function hashFile(file: File): Promise<string> {
  const cached = cache.get(file);
  if (cached) return cached;

  const promise = (async () => {
    const buffer = await file.arrayBuffer();
    // Normalise to a BufferSource view so Web Crypto accepts jsdom/undici File
    // buffers consistently across Node runtimes.
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(buffer));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  })();

  cache.set(file, promise);
  return promise;
}
