/**
 * Client seam over `GET /api/dev/detector-hash` — the run's detector build
 * identity.
 *
 * The hash itself is derived server-side from the working tree
 * (`app/api/dev/detectorSources.ts`); this is only the fetch. It is read once
 * per scan, at the start of the run, so the value describes the code the run is
 * about to execute rather than whatever is on disk by the time diagnostics are
 * assembled.
 *
 * Two properties matter here and both are load-bearing:
 *
 *  - **`cache: "no-store"`.** A cached response would freeze the hash for the
 *    life of the page, which is precisely the `appVersion` defect it exists to
 *    detect.
 *  - **Failure yields `null`, never a stale or invented value.** The harness
 *    treats a missing hash as unknown provenance and degrades to today's
 *    behaviour; it must never treat a wrong hash as evidence.
 *
 * Framework-agnostic — no React imports.
 */

/**
 * The detector code hash for the code currently on disk, or null when the route
 * is unavailable (any non-dev build) or the read failed.
 */
export async function fetchDetectorCodeHash(): Promise<string | null> {
  try {
    const res = await fetch("/api/dev/detector-hash", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { detectorCodeHash?: unknown };
    return typeof body.detectorCodeHash === "string" && body.detectorCodeHash.length > 0
      ? body.detectorCodeHash
      : null;
  } catch {
    return null;
  }
}
