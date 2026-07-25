#!/usr/bin/env node
/**
 * scripts/merge-landing-replay.mjs
 *
 * Assemble the checked-in landing replay playlist from N exported clips.
 *
 * Run via:
 *   node scripts/merge-landing-replay.mjs clip-a.json clip-b.json clip-c.json
 *   node scripts/merge-landing-replay.mjs --out tmp/playlist.json clip-a.json
 *
 * **Argument order is play order.** The hero plays `items` in array order and
 * offers no reorder UI, so the order typed on the command line is the order a
 * visitor sees. Item 0 additionally sets the stage shape for the whole run of the
 * page (see the aspect warning below).
 *
 * The alternative this replaces is hand-concatenating `items` arrays inside a
 * three-quarter-megabyte file of base64, where a duplicate id, a sixth item or a
 * mismatched aspect are all silent failures. Here they are refused (or, for the
 * aspect, named) at assembly time.
 *
 * Scope, deliberately: this reads files and writes one file. It does not touch
 * S3, does not read the repo's git state, and publishes nothing — the same
 * posture as the `/dev/landing-clip` authoring route. Making the result live is
 * committing it; rolling it back is reverting that commit.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Contract constants, mirrored from pipeline/overlay/landingReplayItem.ts.
//
// This script is plain ESM run by `node` with no build step, so it cannot import
// the TypeScript contract (which itself imports through the `@/` alias). The
// mirror is kept honest by __tests__/scripts/mergeLandingReplay.test.ts, which
// asserts the script's verdicts against the real `isReplayItem` and the real
// constants. Change one side and that suite fails.
// ---------------------------------------------------------------------------

/** LANDING_REPLAY_VERSION */
const VERSION = 1;
/** REPLAY_PLAYLIST_MAX */
const PLAYLIST_MAX = 5;
/** REPLAY_ASPECT_TOLERANCE */
const ASPECT_TOLERANCE = 0.02;
/** LANDING_REPLAY_ASSET_PATH, as a repo-relative path. */
const DEFAULT_OUT = "public/landing-replay.json";

const USAGE = `Usage: node scripts/merge-landing-replay.mjs [--out <path>] <clip.json> [clip.json ...]

Concatenates exported landing replay clips into one playlist, in argument order
(argument order is play order). Writes ${DEFAULT_OUT} unless --out says otherwise.`;

/** A refusal the maintainer is meant to read, not a crash. */
class MergeError extends Error {}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Parse argv into `{ out, inputs, help }`, refusing anything malformed. */
export function parseArgs(argv) {
  const inputs = [];
  let out = DEFAULT_OUT;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true, out, inputs };
    if (arg === "--out" || arg === "-o") {
      const next = argv[i + 1];
      if (!next) throw new MergeError("--out needs a path.");
      out = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) throw new MergeError(`unknown option ${arg}.`);
    inputs.push(arg);
  }

  if (inputs.length === 0) throw new MergeError(`no clips given.\n\n${USAGE}`);
  return { help: false, out, inputs };
}

/**
 * Read one exported file into its items.
 *
 * Accepts either the `{ version, items: [ … ] }` wrapper the authoring route
 * downloads or a bare item object, because a maintainer who pulled one item out
 * of a playlist to re-order it should not have to re-wrap it by hand.
 */
export function readClip(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    const reason = error && typeof error === "object" && "code" in error ? error.code : error;
    throw new MergeError(`cannot read ${path} (${reason}).`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new MergeError(`${path} is not valid JSON (${error.message}).`);
  }

  if (!data || typeof data !== "object") throw new MergeError(`${path} is not an object.`);
  const items = Array.isArray(data.items) ? data.items : [data];
  if (items.length === 0) throw new MergeError(`${path} carries no items.`);
  return items;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Concatenate the read clips into a playlist file, refusing the mistakes that
 * are silent once the asset is checked in.
 *
 * `clips` is `[{ path, items }]` in argument order. Returns
 * `{ file, warnings }` — warnings are printed but do not stop the write.
 */
export function assemble(clips) {
  const items = [];
  const origin = new Map();

  for (const clip of clips) {
    for (const [index, item] of clip.items.entries()) {
      if (!isReplayItemLike(item)) {
        throw new MergeError(
          `${clip.path} item ${index} is not a landing replay item — ` +
            `re-export it from /dev/landing-clip rather than editing it by hand.`,
        );
      }
      const first = origin.get(item.id);
      if (first) {
        throw new MergeError(
          `duplicate id ${item.id}: ${first} and ${clip.path} carry the same clip. ` +
            `Ids are how items are told apart — export a second clip rather than listing one twice.`,
        );
      }
      origin.set(item.id, clip.path);
      items.push(item);
    }
  }

  if (items.length > PLAYLIST_MAX) {
    throw new MergeError(
      `${items.length} items, but the hero plays at most ${PLAYLIST_MAX} — ` +
        `the rest would be dropped silently at load. Drop ${plural(items.length - PLAYLIST_MAX, "clip")}.`,
    );
  }

  return { file: { version: VERSION, items }, warnings: aspectWarnings(items) };
}

/**
 * Name every item whose source plane disagrees with item 0's.
 *
 * The stage takes its shape from `items[0].source` and holds it for the whole
 * playlist — deliberately, so a handoff cannot reflow the page — which means a
 * portrait clip in a landscape-led playlist letterboxes. That still plays, so
 * this warns rather than refuses; the point is that the maintainer hears it here
 * instead of discovering it on the landing page.
 */
export function aspectWarnings(items) {
  if (items.length < 2) return [];
  const stage = items[0].source.w / items[0].source.h;
  const warnings = [];

  for (const [index, item] of items.entries()) {
    if (index === 0) continue;
    const aspect = item.source.w / item.source.h;
    if (Math.abs(aspect - stage) / stage <= ASPECT_TOLERANCE) continue;
    warnings.push(
      `item ${index} (${item.id}) is ${item.source.w}x${item.source.h} (${aspect.toFixed(3)}) ` +
        `but item 0 sets the stage at ${items[0].source.w}x${items[0].source.h} ` +
        `(${stage.toFixed(3)}), so item ${index} will letterbox.`,
    );
  }
  return warnings;
}

/**
 * Narrow structural check, mirroring `isReplayItem` in
 * pipeline/overlay/landingReplayItem.ts field for field. Same reasoning as
 * there: it checks what the renderer dereferences, without walking every element
 * of every array.
 */
export function isReplayItemLike(value) {
  if (typeof value !== "object" || value === null) return false;

  if (typeof value.id !== "string") return false;
  if (typeof value.duration !== "number" || !(value.duration > 0)) return false;

  const label = value.label;
  if (!label || typeof label.area !== "string" || typeof label.route !== "string") return false;

  if (!isDims(value.source)) return false;
  if (!isDims(value.photo) || typeof value.photo.webp !== "string") return false;

  if (!Array.isArray(value.starfield) || !Array.isArray(value.matches)) return false;
  if (!Array.isArray(value.holds)) return false;
  if (!Array.isArray(value.poses) || value.poses.length === 0) return false;

  const pose = value.poses[0];
  if (!pose || typeof pose.t !== "number") return false;
  if (!Array.isArray(pose.source) || !Array.isArray(pose.photo)) return false;

  return true;
}

function isDims(value) {
  if (typeof value !== "object" || value === null) return false;
  return typeof value.w === "number" && typeof value.h === "number";
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * The written asset's weight, broken down per clip.
 *
 * Every visitor downloads this file before the hero draws anything, so the
 * budget is worth seeing at the moment it is spent rather than the next time
 * someone opens devtools. The images column is the lever that actually moves —
 * geometry is the remainder.
 */
export function report(file, json) {
  const rows = file.items.map((item, index) => {
    const bytes = Buffer.byteLength(JSON.stringify(item), "utf8");
    const images =
      Buffer.byteLength(item.photo.webp, "utf8") +
      (item.source.webp ? Buffer.byteLength(item.source.webp, "utf8") : 0);
    const label = [item.label.area, item.label.route, item.label.rating]
      .filter(Boolean)
      .join(" / ");
    return { index, id: item.id, label, bytes, images };
  });

  const total = Buffer.byteLength(json, "utf8");
  const idWidth = Math.max(...rows.map((row) => row.id.length), 2);
  const lines = rows.map(
    (row) =>
      `  ${row.index}  ${row.id.padEnd(idWidth)}  ${size(row.bytes).padStart(9)}` +
      `  (${size(row.images)} images)  ${row.label}`,
  );

  return [`${plural(file.items.length, "item")}, ${size(total)} total`, ...lines].join("\n");
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function size(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const { help, out, inputs } = parseArgs(argv);
  if (help) {
    console.log(USAGE);
    return 0;
  }

  const clips = inputs.map((path) => ({ path, items: readClip(path) }));
  const { file, warnings } = assemble(clips);

  const json = `${JSON.stringify(file)}\n`;
  const target = resolve(process.cwd(), out);
  try {
    writeFileSync(target, json, "utf8");
  } catch (error) {
    const reason = error && typeof error === "object" && "code" in error ? error.code : error;
    throw new MergeError(`cannot write ${out} (${reason}).`);
  }

  for (const warning of warnings) console.warn(`warning: ${warning}`);
  // Repo-relative while the target is inside the repo; absolute once it climbs
  // out, because a path of leading `..` segments tells the reader nothing.
  const shown = relative(process.cwd(), target);
  console.log(`Wrote ${shown && !shown.startsWith("..") ? shown : target}`);
  console.log(report(file, json));
  return 0;
}

// Run only as a CLI; the exports above are imported directly by the test suite.
if (process.argv[1] && basename(process.argv[1]) === "merge-landing-replay.mjs") {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof MergeError) {
      console.error(`merge-landing-replay: ${error.message}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
