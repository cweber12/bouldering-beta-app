/**
 * scripts/make-landing-demo.mjs
 *
 * Bakes the landing-page x-ray demo's default asset from a folder of saved runs.
 *
 * The landing page (components/skeleton/XrayReplayDemo) replays the scan
 * loading-screen animation. Signed-in users see their own latest run; everyone
 * else sees a bundled default. This script produces that default: it scans a
 * directory of Save-to-device run JSON files, picks the newest run that has a
 * wall ORB starfield (skipping Panning captures, whose orbFeatures is null),
 * projects it to the slim ReplayData shape via the SAME toReplayData used at
 * runtime, and writes public/landing-demo.json.
 *
 * Run via:  npm run make:landing-demo -- <dir>
 *   <dir>   a folder containing run-*.json files (e.g. your RouteData tree,
 *           searched recursively). Defaults to ./RouteData.
 *
 * Options:
 *   --out=<path>   output file (default: public/landing-demo.json)
 *   --max=<n>      max poses to bake (default: replayData DEFAULT_MAX_POSES)
 *
 * Pure JSON transform — no OpenCV, no MediaPipe, no browser.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toReplayData,
  hasStarfield,
  sortRunFilesNewestFirst,
  DEFAULT_MAX_POSES,
} from "../pipeline/overlay/replayData.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const getOpt = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
};
const positional = args.find((a) => !a.startsWith("--"));

const srcDir = resolve(ROOT, positional ?? "RouteData");
const outFile = resolve(ROOT, getOpt("--out") ?? "public/landing-demo.json");
const maxPoses = getOpt("--max") ? parseInt(getOpt("--max"), 10) : DEFAULT_MAX_POSES;

// ---------------------------------------------------------------------------
// Collect run files (recursive), newest-first
// ---------------------------------------------------------------------------

/** Recursively list every file path under `dir`. */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const allFiles = walk(srcDir);
if (allFiles.length === 0) {
  console.error(`No files found under ${srcDir}. Pass a folder of saved runs, e.g.:`);
  console.error(`  npm run make:landing-demo -- ./RouteData`);
  process.exit(1);
}

// Rank by the run-{timestamp} embedded in the basename, newest first. Map back
// to full paths after sorting on basenames.
const byBasename = new Map();
for (const full of allFiles) {
  const base = full.split(/[\\/]/).pop();
  if (base && !byBasename.has(base)) byBasename.set(base, full);
}
const ranked = sortRunFilesNewestFirst([...byBasename.keys()]).map((b) => byBasename.get(b));

// ---------------------------------------------------------------------------
// Pick the newest run with a starfield, project, write
// ---------------------------------------------------------------------------

let chosenPath = null;
let chosenAttempt = null;
for (const path of ranked) {
  let attempt;
  try {
    attempt = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    continue;
  }
  if (!hasStarfield(attempt)) continue; // skip Panning captures / featureless runs
  chosenPath = path;
  chosenAttempt = attempt;
  break;
}

if (!chosenAttempt) {
  console.error(
    `Found ${ranked.length} run file(s) under ${srcDir}, but none had ORB ` +
    `features (orbFeatures). Fixed Capture runs carry a starfield; Panning ` +
    `captures do not. Scan a Fixed Capture climb, Save-to-device, and retry.`,
  );
  process.exit(1);
}

const replay = toReplayData(chosenAttempt, { maxPoses });
writeFileSync(outFile, JSON.stringify(replay));

const rel = (p) => p.replace(ROOT + "\\", "").replace(ROOT + "/", "");
console.log(`Baked landing demo from ${rel(chosenPath)}`);
console.log(`  ${replay.starfield.length} starfield points, ${replay.poses.length} poses`);
console.log(`  aspect ${replay.aspect.w}x${replay.aspect.h}`);
console.log(`Wrote ${rel(outFile)} (${(statSync(outFile).size / 1024).toFixed(1)} KiB)`);
