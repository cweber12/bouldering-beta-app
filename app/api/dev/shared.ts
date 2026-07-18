/**
 * Dev-only test-corpus harness — shared helpers.
 *
 * Bridges beta-scanner's browser pipeline to an external downloader program's
 * `analysis/` corpus of Test Videos (see docs/adr/0017). Everything here is
 * gated on `NODE_ENV === "development"`: the routes 404 in production, where
 * there is no local corpus and the filesystem is read-only. Same posture as the
 * ADR 0006 diagnostics sink.
 *
 * No React / Next imports — pure Node + validation, so the path-safety helpers
 * are unit-testable in isolation.
 */

import { readdir, readFile, access } from "node:fs/promises";
import path from "node:path";

/** True only in a local dev server — the harness never exists in prod. */
export const HARNESS_ENABLED = process.env.NODE_ENV === "development";

/** Absolute path to the external downloader's `analysis/` root, or null. */
export function analysisRoot(): string | null {
  const root = process.env.HARNESS_ANALYSIS_ROOT?.trim();
  return root ? path.resolve(root) : null;
}

/** Base URL of the external downloader API (for relaying detection runs), or null. */
export function harnessApiBase(): string | null {
  const base = process.env.HARNESS_API_BASE?.trim();
  return base ? base.replace(/\/+$/, "") : null;
}

// ---------------------------------------------------------------------------
// Path safety — a bundle key is `<routeFolder>/<videoKey>`, both supplied by
// the client. Never trust it: reject traversal and anything that resolves
// outside the analysis root.
// ---------------------------------------------------------------------------

/** A single path segment: must start alphanumeric, then folder-safe chars only. */
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** True when `seg` is a single, traversal-free path segment. */
export function isSafeSegment(seg: string): boolean {
  return seg.length > 0 && seg.length <= 255 && seg !== "." && seg !== ".." && SEGMENT_RE.test(seg);
}

/**
 * A bundle key is exactly `<routeFolder>/<videoKey>`. Valid only when it splits
 * into two safe segments (no traversal, no extra separators).
 */
export function parseBundleKey(key: string): { routeFolder: string; videoKey: string } | null {
  const parts = key.split("/");
  if (parts.length !== 2) return null;
  const [routeFolder, videoKey] = parts;
  if (!isSafeSegment(routeFolder) || !isSafeSegment(videoKey)) return null;
  return { routeFolder, videoKey };
}

/**
 * Resolve a bundle key to its absolute directory under the analysis root, or
 * null when the key is unsafe, escapes the root, or no root is configured.
 */
export function resolveBundleDir(key: string): string | null {
  const root = analysisRoot();
  if (!root) return null;
  const parsed = parseBundleKey(key);
  if (!parsed) return null;
  const dir = path.resolve(root, parsed.routeFolder, parsed.videoKey);
  // Containment guard: the resolved dir must stay within the root.
  const rel = path.relative(root, dir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return dir;
}

/**
 * The external-API relative video path derived from a bundle key. The downloader
 * derives route_folder / video_key from the parent+grandparent folder names and
 * ignores the file name, so this shape is all it needs.
 */
export function relativeVideoPath(routeFolder: string, videoKey: string): string {
  return `analysis/${routeFolder}/${videoKey}/${videoKey}.mp4`;
}

// ---------------------------------------------------------------------------
// Corpus reading (filesystem)
// ---------------------------------------------------------------------------

/** One Test Video bundle as surfaced to the dev harness page. */
export interface CorpusItem {
  /** `<routeFolder>/<videoKey>` — the bundle key. */
  key: string;
  routeFolder: string;
  videoKey: string;
  /** `source_title` from metadata.json, if present. */
  title: string | null;
  /** External-API relative path for detection POSTs. */
  videoPath: string;
  /** True when a Scan Setup has been calibrated for this video. */
  hasSetup: boolean;
  /**
   * True when the video has accepted Ground Truth. `ground-truth.json` is only
   * ever written by Accept & save, so existence is acceptance — this is the
   * batch Analyze gate.
   */
  hasGroundTruth: boolean;
  /** Number of detection runs already written to the bundle. */
  runCount: number;
  /** The human-labelled `analysis_inputs` block, passed through verbatim. */
  analysisInputs: unknown;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Count detection runs by the `*_pose.json` files written per run. */
async function countRuns(detectionsDir: string): Promise<number> {
  try {
    const files = await readdir(detectionsDir);
    return files.filter((f) => f.endsWith("_pose.json")).length;
  } catch {
    return 0;
  }
}

/**
 * Enumerate every Test Video bundle under the analysis root. A directory is a
 * bundle only when it holds a readable `metadata.json` at
 * `<root>/<routeFolder>/<videoKey>/`. Returns pending (un-calibrated) videos
 * first, then by key.
 */
export async function listCorpus(): Promise<CorpusItem[]> {
  const root = analysisRoot();
  if (!root) return [];

  let routeEntries;
  try {
    routeEntries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const items: CorpusItem[] = [];
  for (const routeEnt of routeEntries) {
    if (!routeEnt.isDirectory() || !isSafeSegment(routeEnt.name)) continue;
    const routeDir = path.join(root, routeEnt.name);

    let videoEntries;
    try {
      videoEntries = await readdir(routeDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const vEnt of videoEntries) {
      if (!vEnt.isDirectory() || !isSafeSegment(vEnt.name)) continue;
      const bundleDir = path.join(routeDir, vEnt.name);

      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(await readFile(path.join(bundleDir, "metadata.json"), "utf8"));
      } catch {
        continue; // no / invalid metadata → not a bundle
      }

      const [hasSetup, hasGroundTruth, runCount] = await Promise.all([
        exists(path.join(bundleDir, "setup.json")),
        exists(path.join(bundleDir, "ground-truth.json")),
        countRuns(path.join(bundleDir, "detections")),
      ]);

      items.push({
        key: `${routeEnt.name}/${vEnt.name}`,
        routeFolder: routeEnt.name,
        videoKey: vEnt.name,
        title: typeof meta.source_title === "string" ? meta.source_title : null,
        videoPath: relativeVideoPath(routeEnt.name, vEnt.name),
        hasSetup,
        hasGroundTruth,
        runCount,
        analysisInputs: meta.analysis_inputs ?? null,
      });
    }
  }

  items.sort((a, b) => Number(a.hasSetup) - Number(b.hasSetup) || a.key.localeCompare(b.key));
  return items;
}
