/**
 * scripts/diagnostics-report.mjs
 *
 * Summarises the dev-local detection-diagnostics JSONL files into readable
 * tables — so the raw records in diagnostics/scans.jsonl and
 * diagnostics/matches.jsonl can be trended without hand-writing jq queries.
 *
 * Run via: npm run diagnostics:report  [-- options]
 *
 * Options:
 *   --scans-only         only report scans
 *   --matches-only       only report matches
 *   --app=<sha>          only include records with this appVersion
 *   --no-dedupe          keep every line (default: collapse tag re-ships,
 *                        keeping the latest line per run / per run×image)
 *   --dir=<path>         diagnostics directory (default: ./diagnostics)
 *
 * The files are written only by `npm run dev` on the developer's machine and
 * are gitignored — see docs/adr/0006-dev-local-detection-diagnostics.md.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const getOpt = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
};

const opts = {
  scansOnly: hasFlag("--scans-only"),
  matchesOnly: hasFlag("--matches-only"),
  app: getOpt("--app"),
  dedupe: !hasFlag("--no-dedupe"),
  dir: getOpt("--dir") ?? resolve(ROOT, "diagnostics"),
};

// ---------------------------------------------------------------------------
// IO + helpers
// ---------------------------------------------------------------------------

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const out = [];
  const lines = readFileSync(path, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines rather than aborting the whole report.
    }
  }
  return out;
}

/** Keep the latest record per key (collapses tag re-ships). */
function dedupeBy(records, keyFn) {
  const map = new Map();
  for (const r of records) map.set(keyFn(r), r);
  return [...map.values()];
}

function stat(nums) {
  const xs = nums.filter((n) => Number.isFinite(n));
  if (xs.length === 0) return { n: 0, min: NaN, avg: NaN, max: NaN };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const x of xs) {
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
  }
  return { n: xs.length, min, avg: sum / xs.length, max };
}

const num = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");
const pct = (n) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—");

/** Group records by a string key, returning a Map<key, records[]>. */
function groupBy(records, keyFn) {
  const map = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

/** Render an array of row objects as an aligned text table. */
function table(headers, rows) {
  const cols = headers.map((h) => h.key);
  const widths = headers.map((h) =>
    Math.max(h.label.length, ...rows.map((r) => String(r[h.key] ?? "").length)),
  );
  const fmtRow = (cells) =>
    "  " + cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ").trimEnd();
  const lines = [
    fmtRow(headers.map((h) => h.label)),
    fmtRow(widths.map((w) => "-".repeat(w))),
    ...rows.map((r) => fmtRow(cols.map((c) => r[c]))),
  ];
  return lines.join("\n");
}

function heading(text) {
  return `\n${text}\n${"=".repeat(text.length)}`;
}

// ---------------------------------------------------------------------------
// Scan report
// ---------------------------------------------------------------------------

const SCAN_FLAGS = ["isOverexposed", "isUnderexposed", "isBacklit", "isLowContrast", "isBlurry"];

function reportScans(records) {
  console.log(heading(`Scan Diagnostics — ${records.length} records`));
  if (records.length === 0) {
    console.log("  (no scan records)");
    return;
  }

  const uniqueVideos = new Set(records.map((r) => r.videoHash)).size;
  const rate = stat(records.map((r) => r.result.pose.detectionRate));
  const conf = stat(records.map((r) => r.result.pose.confidence.avg));
  const refKp = stat(records.map((r) => r.result.orb.refKeypointCount));
  const withBad = records.filter((r) => r.result.badStretches.length > 0).length;

  console.log(`  unique videos:    ${uniqueVideos}`);
  console.log(`  detection rate:   avg ${pct(rate.avg)}  (min ${pct(rate.min)}, max ${pct(rate.max)})`);
  console.log(`  confidence avg:   ${num(conf.avg)}  (min ${num(conf.min)}, max ${num(conf.max)})`);
  console.log(`  ref ORB keypts:   avg ${num(refKp.avg, 0)}  (min ${num(refKp.min, 0)}, max ${num(refKp.max, 0)})`);
  console.log(`  with bad stretch: ${withBad} / ${records.length}`);

  // By capture mode.
  console.log("\n  By capture mode:");
  const byMode = groupBy(records, (r) => r.input.captureMode);
  console.log(
    table(
      [
        { key: "mode", label: "mode" },
        { key: "n", label: "n" },
        { key: "rate", label: "detect rate" },
        { key: "conf", label: "conf avg" },
      ],
      [...byMode.entries()].map(([mode, rs]) => ({
        mode,
        n: rs.length,
        rate: pct(stat(rs.map((r) => r.result.pose.detectionRate)).avg),
        conf: num(stat(rs.map((r) => r.result.pose.confidence.avg)).avg),
      })),
    ),
  );

  // Condition flag → keypoints / detection rate (answers the ADR question
  // "are backlit climber crops correlated with low keypoint counts?").
  console.log("\n  By condition flag (vs. flag absent):");
  console.log(
    table(
      [
        { key: "flag", label: "flag" },
        { key: "n", label: "n" },
        { key: "kpOn", label: "kp (flag)" },
        { key: "kpOff", label: "kp (no flag)" },
        { key: "rateOn", label: "rate (flag)" },
      ],
      SCAN_FLAGS.map((flag) => {
        const on = records.filter((r) => r.input.referenceFrame.flags[flag]);
        const off = records.filter((r) => !r.input.referenceFrame.flags[flag]);
        return {
          flag: flag.replace(/^is/, ""),
          n: on.length,
          kpOn: num(stat(on.map((r) => r.result.orb.refKeypointCount)).avg, 0),
          kpOff: num(stat(off.map((r) => r.result.orb.refKeypointCount)).avg, 0),
          rateOn: pct(stat(on.map((r) => r.result.pose.detectionRate)).avg),
        };
      }),
    ),
  );

  // Manual overlay-quality tags.
  reportTags(records, "overlayQuality", "Overlay quality tags", (rs) => ({
    rate: pct(stat(rs.map((r) => r.result.pose.detectionRate)).avg),
    extra: "detect rate",
  }));
}

// ---------------------------------------------------------------------------
// Match report
// ---------------------------------------------------------------------------

const matchRatio = (r) =>
  typeof r.result.inlierRatio === "number" ? r.result.inlierRatio : r.result.inlierRatio.avg;

function reportMatches(records) {
  console.log(heading(`Match Diagnostics — ${records.length} records`));
  if (records.length === 0) {
    console.log("  (no match records)");
    return;
  }

  const found = records.filter((r) => r.result.homographyFound).length;
  const ratio = stat(records.map(matchRatio));
  const queryKp = stat(records.map((r) => r.input.query.queryKeypointCount));

  console.log(`  homography found: ${found} / ${records.length}  (${pct(found / records.length)})`);
  console.log(`  inlier ratio:     avg ${pct(ratio.avg)}  (min ${pct(ratio.min)}, max ${pct(ratio.max)})`);
  console.log(`  query keypoints:  avg ${num(queryKp.avg, 0)}  (min ${num(queryKp.min, 0)}, max ${num(queryKp.max, 0)})`);

  // Failure-reason distribution.
  console.log("\n  By failure reason:");
  const byReason = groupBy(records, (r) => r.result.failureReason);
  console.log(
    table(
      [
        { key: "reason", label: "reason" },
        { key: "n", label: "n" },
        { key: "ratio", label: "inlier ratio" },
      ],
      [...byReason.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([reason, rs]) => ({
          reason,
          n: rs.length,
          ratio: pct(stat(rs.map(matchRatio)).avg),
        })),
    ),
  );

  // By capture mode.
  console.log("\n  By capture mode:");
  const byMode = groupBy(records, (r) => r.result.captureMode);
  console.log(
    table(
      [
        { key: "mode", label: "mode" },
        { key: "n", label: "n" },
        { key: "found", label: "homography" },
        { key: "ratio", label: "inlier ratio" },
      ],
      [...byMode.entries()].map(([mode, rs]) => ({
        mode,
        n: rs.length,
        found: pct(rs.filter((r) => r.result.homographyFound).length / rs.length),
        ratio: pct(stat(rs.map(matchRatio)).avg),
      })),
    ),
  );

  // Manual match-quality tags.
  reportTags(records, "matchQuality", "Match quality tags", (rs) => ({
    rate: pct(stat(rs.map(matchRatio)).avg),
    extra: "inlier ratio",
  }));
}

// ---------------------------------------------------------------------------
// Shared: tag distribution
// ---------------------------------------------------------------------------

function reportTags(records, field, title, summarise) {
  const tagged = records.filter((r) => r.result[field] != null);
  console.log(`\n  ${title}:`);
  if (tagged.length === 0) {
    console.log(`    (none tagged — use the panel's quality buttons)`);
    return;
  }
  const byTag = groupBy(tagged, (r) => r.result[field]);
  const sample = summarise([...byTag.values()][0]);
  console.log(
    table(
      [
        { key: "tag", label: "tag" },
        { key: "n", label: "n" },
        { key: "metric", label: sample.extra },
      ],
      [...byTag.entries()].map(([tag, rs]) => ({
        tag,
        n: rs.length,
        metric: summarise(rs).rate,
      })),
    ),
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function load(file, keyFn) {
  let records = readJsonl(resolve(opts.dir, file));
  if (opts.app) records = records.filter((r) => r.appVersion === opts.app);
  if (opts.dedupe) records = dedupeBy(records, keyFn);
  return records;
}

function main() {
  console.log(`Diagnostics report — ${opts.dir}${opts.app ? `  (appVersion=${opts.app})` : ""}`);

  if (!opts.matchesOnly) {
    reportScans(load("scans.jsonl", (r) => r.scanId));
  }
  if (!opts.scansOnly) {
    reportMatches(load("matches.jsonl", (r) => `${r.scanId}|${r.imageHash}`));
  }
  console.log("");
}

main();
