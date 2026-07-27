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
import {
  runPairsWithTruth,
  truthIsStale,
  scaffoldIsSeedReady,
  scaffoldIsUntrackable,
} from "@/utils/harnessFreshness";
import { parseViTPoseScaffold, type ViTPoseScaffold } from "@/utils/harnessViTPose";
import { summarizeRunFile, type HarnessRunFacts } from "@/utils/harnessRuns";

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
  /**
   * True when the truth exists but stamps an older calibration's `setupHash`
   * than the current `setup.json` — it pairs with no run scanned under the
   * current Setup, so an "accepted" badge must not read as healthy
   * (utils/harnessFreshness, harness issue #21).
   */
  truthStale: boolean;
  /**
   * True when the bundle's ViTPose scaffold can seed Ground Truth review with
   * no new job: `vitpose.json` exists, stamps the current calibration's
   * `setupHash` (legacy unstamped scaffolds qualify), and poses at least one
   * Detection Frame (utils/harnessFreshness). With a stale truth this is the
   * "stale · seed ready" state — one click from review once opened.
   */
  seedReady: boolean;
  /**
   * True when the bundle is **Untrackable**: its ViTPose scaffold belongs to the
   * current calibration but poses no Detection Frame — the tracker matched no
   * Climber to this seed (utils/harnessFreshness). Scoped to bundles without
   * fresh truth (`!hasGroundTruth || truthStale`), so a fresh-truth bundle whose
   * later re-seed landed nothing keeps its good evidence and is never Untrackable.
   * The batch calibration and re-seed sweeps hold these out until a re-seed lands
   * landmarks; the corpus row flags them rather than dropping them.
   */
  untrackable: boolean;
  /**
   * The climb start — the **setup** tap's `t` (`climberPoint.t`), when the Scan
   * Setup carries one. Never the seed tap's: the seed tap moves with every
   * re-seed, and conflating the two is the defect harness ADR 0007 removes.
   * Absent when the bundle has no Setup, no tap, or a legacy tap without a time.
   */
  climbStart?: number;
  /**
   * The end-of-climb marker (`setup.json.climbEnd`), when the bundle has been
   * marked. Absent means the window is open on that side — how the harness
   * behaves today — so the corpus row reads it as a to-do, not an error. Surfaced
   * so the Mark-ends sweep can plan its queue without reading ninety setups.
   */
  climbEnd?: number;
  /** Number of detection runs already written to the bundle. */
  runCount: number;
  /**
   * Detection runs whose stamped `setupHash` pairs with the truth's — real
   * evaluation evidence. Always 0 for truthless bundles (that is its own
   * surfaced state); a `pairedRunCount` of 0 on a fresh-truth bundle is what
   * "un-analyzed" batch scope keys on.
   */
  pairedRunCount: number;
  /**
   * Detection runs whose stamped `setupHash` does not pair with the truth's —
   * they produce no evaluation evidence. Always 0 for truthless bundles (that
   * is its own surfaced state).
   */
  unpairedRunCount: number;
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

/** The `setup.json` facts the corpus row shows beyond the hash and its existence. */
interface SetupFacts {
  /**
   * The `analysisInputs` block, or null. The harness reads condition labels only
   * from here — the `metadata.json` `analysis_inputs` passthrough is a legacy
   * fallback for bundles calibrated before the move.
   */
  analysisInputs: unknown;
  /** `climberPoint.t` — the climb start. Absent on a legacy tap with no time. */
  climbStart?: number;
  /** The end-of-climb marker, absent when the bundle is unmarked. */
  climbEnd?: number;
}

/** Read the bundle's `setup.json` facts, or empty when missing/invalid. */
async function readSetupFacts(bundleDir: string): Promise<SetupFacts> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(bundleDir, "setup.json"), "utf8"),
    ) as Record<string, unknown>;
    const point = parsed.climberPoint as { t?: unknown } | null | undefined;
    const climbStart = typeof point?.t === "number" && Number.isFinite(point.t) ? point.t : undefined;
    const climbEnd =
      typeof parsed.climbEnd === "number" && Number.isFinite(parsed.climbEnd)
        ? parsed.climbEnd
        : undefined;
    return { analysisInputs: parsed.analysisInputs ?? null, climbStart, climbEnd };
  } catch {
    return { analysisInputs: null };
  }
}

/** Read one JSON file's top-level `setupHash` string, or null when absent. */
async function readJsonSetupHash(filePath: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    return typeof parsed.setupHash === "string" && parsed.setupHash.length > 0
      ? parsed.setupHash
      : null;
  } catch {
    return null;
  }
}

/** The bundle's current `setup.json` `setupHash`, or null when uncalibrated. */
export async function readSetupHash(bundleDir: string): Promise<string | null> {
  return readJsonSetupHash(path.join(bundleDir, "setup.json"));
}

/** The bundle's parsed `vitpose.json` scaffold, or null when absent/malformed. */
async function readScaffold(bundleDir: string): Promise<ViTPoseScaffold | null> {
  try {
    const raw = await readFile(path.join(bundleDir, "vitpose.json"), "utf8");
    return parseViTPoseScaffold(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Detection runs — one walk, one per-file read, shared by the corpus lister's
// counts and the run-list route. The files are the large artifacts in a bundle
// (tens of MB each), so the walk is separated from the read: a caller that only
// needs the count never parses them.
// ---------------------------------------------------------------------------

/** A detection run file located on disk, before it has been read. */
export interface RunFileRef {
  /** The run identifier — the `<runTs>` of `<runTs>_pose.json`. */
  runTs: string;
  /** Absolute path to the run file. */
  filePath: string;
}

/** The `detections/` directory of a bundle. */
export function detectionsDir(bundleDir: string): string {
  return path.join(bundleDir, "detections");
}

/**
 * Every `*_pose.json` run file in a bundle's `detections/`, newest first. Run
 * identifiers are `YYYYMMDD-HHMMSS`, so a reverse lexicographic sort is
 * chronological. Empty when the bundle has never been analyzed.
 */
export async function listRunFiles(dir: string): Promise<RunFileRef[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith("_pose.json"));
  } catch {
    return [];
  }
  return files
    .map((f) => ({ runTs: f.slice(0, -"_pose.json".length), filePath: path.join(dir, f) }))
    .sort((a, b) => b.runTs.localeCompare(a.runTs));
}

/**
 * Read one run file's list-level facts — the stamps and the verdict rollup,
 * never the frames or detector attempts. An unreadable or non-JSON file comes
 * back flagged `malformed` rather than throwing: one bad file must not take out
 * a bundle's listing (or the whole corpus walk).
 */
export async function readRunFacts(ref: RunFileRef): Promise<HarnessRunFacts> {
  try {
    return summarizeRunFile(JSON.parse(await readFile(ref.filePath, "utf8")));
  } catch {
    return {
      writtenAt: null,
      setupHash: null,
      groundTruthHash: null,
      verdicts: null,
      malformed: true,
    };
  }
}

/** Detection-run counts: total `*_pose.json` runs and how many pair with truth. */
interface RunCounts {
  runCount: number;
  pairedRunCount: number;
  unpairedRunCount: number;
}

/**
 * Count detection runs by the `*_pose.json` files written per run, and — when
 * the bundle has Ground Truth — split them into those whose stamped `setupHash`
 * pairs with the truth (real evaluation evidence) and those that do not (they
 * produce none in the harness). A truthless bundle pairs nothing, so both
 * counts stay 0 there — that is its own already-surfaced state, and it is why
 * the files are only opened when there is truth to pair against.
 */
async function countRuns(
  dir: string,
  truthSetupHash: string | null,
  setupHash: string | null,
  hasTruth: boolean,
): Promise<RunCounts> {
  const refs = await listRunFiles(dir);
  if (!hasTruth) {
    return { runCount: refs.length, pairedRunCount: 0, unpairedRunCount: 0 };
  }

  let pairedRunCount = 0;
  let unpairedRunCount = 0;
  for (const ref of refs) {
    const { setupHash: runHash } = await readRunFacts(ref);
    if (runPairsWithTruth(runHash, truthSetupHash, setupHash)) pairedRunCount += 1;
    else unpairedRunCount += 1;
  }
  return { runCount: refs.length, pairedRunCount, unpairedRunCount };
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

      const [hasSetup, hasGroundTruth, setupHash, truthSetupHash] = await Promise.all([
        exists(path.join(bundleDir, "setup.json")),
        exists(path.join(bundleDir, "ground-truth.json")),
        readSetupHash(bundleDir),
        readJsonSetupHash(path.join(bundleDir, "ground-truth.json")),
      ]);
      const [scaffold, { runCount, pairedRunCount, unpairedRunCount }, setupFacts] =
        await Promise.all([
          readScaffold(bundleDir),
          countRuns(detectionsDir(bundleDir), truthSetupHash, setupHash, hasGroundTruth),
          readSetupFacts(bundleDir),
        ]);
      const truthStale = hasGroundTruth && truthIsStale(truthSetupHash, setupHash);
      // Untrackable only matters where there is no fresh evidence to fall back on:
      // a fresh-truth bundle keeps its accepted Ground Truth even if a later
      // re-seed posed nothing, so it is never held out of the sweeps.
      const untrackable =
        (!hasGroundTruth || truthStale) && scaffoldIsUntrackable(scaffold, setupHash);

      items.push({
        key: `${routeEnt.name}/${vEnt.name}`,
        routeFolder: routeEnt.name,
        videoKey: vEnt.name,
        title: typeof meta.source_title === "string" ? meta.source_title : null,
        videoPath: relativeVideoPath(routeEnt.name, vEnt.name),
        hasSetup,
        hasGroundTruth,
        truthStale,
        seedReady: scaffoldIsSeedReady(scaffold, setupHash),
        untrackable,
        ...(setupFacts.climbStart !== undefined ? { climbStart: setupFacts.climbStart } : {}),
        ...(setupFacts.climbEnd !== undefined ? { climbEnd: setupFacts.climbEnd } : {}),
        runCount,
        pairedRunCount,
        unpairedRunCount,
        analysisInputs: setupFacts.analysisInputs ?? meta.analysis_inputs ?? null,
      });
    }
  }

  items.sort((a, b) => Number(a.hasSetup) - Number(b.hasSetup) || a.key.localeCompare(b.key));
  return items;
}
