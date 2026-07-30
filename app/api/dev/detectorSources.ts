/**
 * Per-run detector build identity — the `detectorCodeHash`.
 *
 * `appVersion` answers "which build was this dev server started from". Next
 * resolves `NEXT_PUBLIC_APP_VERSION` once at server start (see `next.config.ts`),
 * so a hot reload moves the running detector without moving the stamp. Every
 * consumer reads that field as "which code produced this run", and the gap
 * between those two questions already contaminated the corpus: 67 runs stamped
 * one build while behaviourally running the next one's fix, with nothing on disk
 * able to tell them apart (harness issue #130).
 *
 * This module closes the gap by deriving a second identifier from the detector
 * sources themselves. Neither field replaces the other — conflict detection is
 * the *pair*: same `appVersion` with a different `detectorCodeHash` is a
 * mid-batch hot reload, and different `appVersion` with the same hash is a
 * commit that never touched detection (runs the harness may legitimately pool).
 *
 * Determinism is the whole product here. A hash keyed to a timestamp, an
 * absolute path, or an unsorted directory walk still moves when the code moves —
 * it just also moves when the code *hasn't*, which makes every run unpoolable
 * and is far harder to notice than a frozen stamp. So:
 *
 *  - newlines are normalized (this corpus is authored on Windows — CRLF vs LF
 *    must not change the hash of identical code);
 *  - a leading BOM is stripped for the same reason;
 *  - only repo-relative POSIX paths enter the digest, never absolute ones;
 *  - the module set is sorted by codepoint (never `localeCompare`, whose order
 *    depends on the machine's ICU data);
 *  - nothing time-, build- or environment-derived is mixed in at all.
 *
 * Server-only: it reads the working tree with `node:fs`. Lives beside
 * `shared.ts` rather than inside it because that module is the corpus
 * filesystem reader, and this is provenance — but both dev routes surface from
 * here.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Digest length in hex characters — a SHA-256 truncated to lowercase hex.
 *
 * 12 because the harness handoff asked for 12–16 for this field. It is *not*
 * parity with `setupHash` / `seedHash`: those are stored as full 64-char
 * digests and truncated only for display (`hashSetupInput` in
 * `utils/harnessSetup.ts`). The handoff described them as 12–16 and was wrong.
 * Nothing depends on the two matching — the harness never parses this value, it
 * compares it for equality and fails open on null.
 */
export const DETECTOR_CODE_HASH_LENGTH = 12;

/**
 * Directories whose every source file is treated as detection behaviour, walked
 * recursively. A directory rather than a file list on purpose: a new module
 * added under `pipeline/pose/` or `pipeline/tracking/` is covered the day it
 * lands, with no manifest to remember to update. A stale manifest is the one
 * failure mode that silently reintroduces the defect this field exists to catch.
 */
export const DETECTOR_SOURCE_DIRS: readonly string[] = ["pipeline/pose", "pipeline/tracking"];

/**
 * Detection-behaviour files outside those directories.
 *
 * `useVideoProcessor` is the detector entry: it owns the seek loop, drives the
 * re-acquire ladder, and holds the constants the ladder reads. `usePoseModel`
 * decides which MediaPipe variant and delegate are loaded. `poseTiers` holds
 * every per-tier detection knob the Scan Setup resolves. `videoSeek` decides
 * which frame the detector is even shown, and `colorBalance` is the only
 * preprocessing applied to that frame before detection.
 *
 * Deliberately excluded, because none of them can alter a keypoint: ORB
 * matching and homography, hold detection, the overlay/render modules, the
 * frame analyzer and ORB preprocessor (analysis-only — MediaPipe detects on the
 * raw colour frame), the harness itself, and all UI and styling.
 */
export const DETECTOR_SOURCE_FILES: readonly string[] = [
  "hooks/usePoseModel.ts",
  "hooks/useVideoProcessor.ts",
  "utils/colorBalance.ts",
  "utils/cropFraction.ts",
  "utils/poseConstants.ts",
  "utils/poseTiers.ts",
  "utils/videoSeek.ts",
];

/** Extensions the directory walk treats as source. */
const SOURCE_EXTENSIONS: readonly string[] = [".ts", ".tsx"];

/** One hashed module: its repo-relative POSIX path and its normalized text. */
export interface DetectorSource {
  /** Repo-relative, forward-slashed. Never absolute — that would key the hash to a checkout. */
  path: string;
  /** File text, already run through {@link normalizeSource}. */
  source: string;
}

/**
 * Strip a leading BOM and collapse CRLF / lone CR to LF, so the same code hashes
 * the same on a Windows checkout and a Linux one.
 */
export function normalizeSource(source: string): string {
  return source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

/** Repo-relative POSIX form of an absolute path. */
function toRepoRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

/**
 * Digest a set of modules into the `detectorCodeHash`.
 *
 * Pure and order-insensitive: entries are sorted by path in codepoint order
 * before hashing, so a directory walk that returns files in a different order on
 * a different filesystem still produces the same digest. Each entry contributes
 * its path, its normalized byte length, and its normalized text, NUL-separated —
 * the length guards against two different splits of the same concatenated bytes
 * colliding.
 */
export function hashDetectorSources(sources: readonly DetectorSource[]): string {
  const ordered = [...sources].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const digest = createHash("sha256");
  for (const entry of ordered) {
    const text = normalizeSource(entry.source);
    digest.update(entry.path, "utf8");
    digest.update("\0");
    digest.update(String(Buffer.byteLength(text, "utf8")), "utf8");
    digest.update("\0");
    digest.update(text, "utf8");
    digest.update("\0");
  }
  return digest.digest("hex").slice(0, DETECTOR_CODE_HASH_LENGTH);
}

/** Every source file under `dir`, recursively, as repo-relative POSIX paths. */
async function walkSourceDir(root: string, dir: string): Promise<string[]> {
  const absolute = path.resolve(root, dir);
  const entries = await readdir(absolute, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkSourceDir(root, toRepoRelative(root, child))));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      found.push(toRepoRelative(root, child));
    }
  }
  return found;
}

/**
 * Resolve the manifest to the concrete list of repo-relative paths to hash,
 * sorted and de-duplicated. Exported for the coverage test, which asserts the
 * modules the ladder and the identity gate live in are actually in the set.
 */
export async function listDetectorSourcePaths(root: string = process.cwd()): Promise<string[]> {
  const walked = await Promise.all(DETECTOR_SOURCE_DIRS.map((dir) => walkSourceDir(root, dir)));
  const unique = new Set([...walked.flat(), ...DETECTOR_SOURCE_FILES]);
  return [...unique].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Read and hash the detector sources as they are on disk right now.
 *
 * **Never memoized, by design.** A cache on the server would survive exactly the
 * event this field exists to catch: Next re-instantiates the client module graph
 * on a hot reload, but a server module holding a memo is not necessarily
 * re-instantiated with it, so the cached digest would go on describing code that
 * no longer runs. The read is a few hundred KB of text and one SHA-256 — cheap
 * enough to redo per request, and it happens once per run, outside the frame
 * loop, so it cannot land in `inferenceMs`.
 *
 * Throws when any listed module cannot be read: a partial digest is worse than
 * no digest, because it looks like a valid hash while silently omitting whatever
 * failed. Callers surface the failure as an absent field, which the harness
 * treats as unknown provenance rather than as a conflict.
 */
export async function computeDetectorCodeHash(root: string = process.cwd()): Promise<string> {
  const paths = await listDetectorSourcePaths(root);
  const sources = await Promise.all(
    paths.map(async (relative) => ({
      path: relative,
      source: normalizeSource(await readFile(path.resolve(root, relative), "utf8")),
    })),
  );
  return hashDetectorSources(sources);
}
