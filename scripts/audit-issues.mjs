/**
 * scripts/audit-issues.mjs
 *
 * Drift audit for the local `.scratch/` issue tracker.
 *
 * Run via: node scripts/audit-issues.mjs
 *
 * The tracker lives as markdown files (see docs/agents/issue-tracker.md). Each
 * issue carries a `Status:` line and, once implementation starts, a `Branch:`
 * line and (on close) a `Merged: <sha>` line. The lifecycle loop is supposed to
 * keep those in lock-step with git reality, but a skipped final step lets them
 * drift. This script catches the two drift states:
 *
 *   1. closed-but-unmerged  — Status is `done` but the `Merged:` sha is missing
 *      or is not an ancestor of the current branch (main). The status lies:
 *      the code was never actually merged.
 *
 *   2. implemented-but-not-closed — Status is still a pre-implementation role
 *      (e.g. `ready-for-agent`) but the issue's `Branch:` has already landed on
 *      main (branch is merged, or its name appears in main's history). The work
 *      shipped and the tracker never moved — the original bug this audit exists
 *      to prevent.
 *
 * Plus tracking-hygiene checks added after the 2026-07-17 audit (which found ten
 * issues that shipped in batch commits without Branch: lines, so drift state 2
 * had nothing to key on, and four PRDs whose Status never moved):
 *
 *   3. incomplete-tracking-block — `done` without a `Branch:` line, or
 *      `in-progress` without a `Branch:` line.
 *   4. missing-prd-status — a PRD.md with no `Status:` line.
 *   5. prd-status-drift — PRD Status inconsistent with its issues: all issues
 *      terminal but PRD not `done`; PRD `done` with non-terminal issues; or any
 *      issue done while the PRD still says `ready-for-agent` (should be
 *      `in-progress`).
 *   6. dangling-supersession — a `Superseded-by:` line pointing at a file that
 *      does not exist.
 *   7. scratch-structure-drift — PRDs must live under
 *      `.scratch/actionable`, `.scratch/parked`, or `.scratch/done`.
 *   8. missing-prd-disposition / prd-disposition-drift — a PRD's
 *      `Disposition:` must exist, match its lane, and stay compatible with its
 *      lifecycle status.
 *
 * Also emits a non-fatal warning for local branches already merged into HEAD
 * (the lifecycle says delete them right after merging).
 *
 * Exits 0 when clean, 1 when any drift is found (so CI / a work-session wrapper
 * can gate on it).
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCRATCH = resolve(ROOT, ".scratch");

const TERMINAL = new Set(["done", "wontfix"]);
const DISPOSITIONS = new Set(["actionable", "parked", "done"]);

function git(args) {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8" }).trim();
}

/** True when `sha` is an ancestor of the current HEAD (i.e. it is in main). */
function isAncestor(sha) {
  try {
    execSync(`git merge-base --is-ancestor ${sha} HEAD`, { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readField(text, field) {
  const m = text.match(new RegExp(`^${field}:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : null;
}

/**
 * Collect every feature directory with its PRD (if any) and issue files.
 * Returns { features, structureDrift }.
 */
function findFeatures() {
  const features = [];
  const structureDrift = [];
  if (!existsSync(SCRATCH)) return { features, structureDrift };

  for (const lane of readdirSync(SCRATCH, { withFileTypes: true })) {
    if (!lane.isDirectory()) continue;
    const laneRel = join(".scratch", lane.name).replace(/\\/g, "/");
    if (!DISPOSITIONS.has(lane.name)) {
      structureDrift.push({
        kind: "scratch-structure-drift",
        rel: laneRel,
        detail: "top-level .scratch directory must be actionable, parked, or done",
      });
      continue;
    }

    const laneDir = join(SCRATCH, lane.name);
    for (const feature of readdirSync(laneDir, { withFileTypes: true })) {
      if (!feature.isDirectory()) continue;
      const dir = join(laneDir, feature.name);
      const prdFile = join(dir, "PRD.md");
      const issuesDir = join(dir, "issues");
      const issueFiles = [];
      if (existsSync(issuesDir)) {
        for (const entry of readdirSync(issuesDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith(".md")) {
            issueFiles.push(join(issuesDir, entry.name));
          }
        }
      }
      features.push({
        name: feature.name,
        disposition: lane.name,
        prdFile: existsSync(prdFile) ? prdFile : null,
        issueFiles,
      });
    }
  }
  return { features, structureDrift };
}

function main() {
  const currentBranch = git("branch --show-current");
  const mergedBranches = new Set(
    git("branch --merged HEAD")
      .split("\n")
      .map((b) => b.replace(/^[*+]?\s*/, "").trim())
      .filter(Boolean)
  );
  // Recent main history subjects, to spot branches that merged then got deleted.
  const historyText = git("log --oneline -n 1000");

  const { features, structureDrift } = findFeatures();
  const drift = [...structureDrift];
  let checked = 0;

  for (const feature of features) {
    const issueStatuses = [];

    for (const file of feature.issueFiles) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
      const text = readFileSync(file, "utf8");
      const status = (readField(text, "Status") || "").toLowerCase();
      const branch = readField(text, "Branch");
      const merged = readField(text, "Merged");
      const supersededBy = readField(text, "Superseded-by");
      if (!status) continue;
      checked++;
      issueStatuses.push(status);

      if (supersededBy && !existsSync(resolve(ROOT, supersededBy))) {
        drift.push({
          kind: "dangling-supersession",
          rel,
          detail: `Superseded-by: ${supersededBy} does not exist`,
        });
      }

      if (status === "done") {
        if (!branch) {
          drift.push({ kind: "incomplete-tracking-block", rel, detail: "Status: done but no Branch: line recorded" });
        }
        if (!merged) {
          drift.push({ kind: "closed-but-unmerged", rel, detail: "Status: done but no Merged: sha recorded" });
        } else if (!isAncestor(merged)) {
          drift.push({ kind: "closed-but-unmerged", rel, detail: `Merged: ${merged} is not an ancestor of main` });
        }
        continue;
      }

      if (status === "in-progress" && !branch) {
        drift.push({ kind: "incomplete-tracking-block", rel, detail: "Status: in-progress but no Branch: line recorded" });
      }

      if (TERMINAL.has(status)) continue; // wontfix: nothing to verify

      // Pre-implementation status: has the work already landed?
      if (branch) {
        const landed = mergedBranches.has(branch) || historyText.includes(branch);
        if (landed) {
          drift.push({
            kind: "implemented-but-not-closed",
            rel,
            detail: `Status: ${status} but branch ${branch} is already in main`,
          });
        }
      }
    }

    // ---- PRD status consistency -------------------------------------------
    if (feature.prdFile) {
      const rel = feature.prdFile.slice(ROOT.length + 1).replace(/\\/g, "/");
      const prdText = readFileSync(feature.prdFile, "utf8");
      const prdStatus = (readField(prdText, "Status") || "").toLowerCase();
      const prdDisposition = (readField(prdText, "Disposition") || "").toLowerCase();
      if (!prdStatus) {
        drift.push({ kind: "missing-prd-status", rel, detail: "PRD has no Status: line" });
      }
      if (!prdDisposition) {
        drift.push({ kind: "missing-prd-disposition", rel, detail: "PRD has no Disposition: line" });
      } else if (prdDisposition !== feature.disposition) {
        drift.push({
          kind: "prd-disposition-drift",
          rel,
          detail: `Disposition is ${prdDisposition} but PRD lives under .scratch/${feature.disposition}`,
        });
      }
      if (prdDisposition === "done" && prdStatus && !TERMINAL.has(prdStatus)) {
        drift.push({
          kind: "prd-disposition-drift",
          rel,
          detail: `Disposition is done but PRD Status is ${prdStatus}`,
        });
      } else if (prdDisposition !== "done" && TERMINAL.has(prdStatus)) {
        drift.push({
          kind: "prd-disposition-drift",
          rel,
          detail: `PRD Status is ${prdStatus} but Disposition is ${prdDisposition || "missing"}`,
        });
      }

      if (prdStatus && issueStatuses.length > 0) {
        const allTerminal = issueStatuses.every((s) => TERMINAL.has(s));
        const anyDone = issueStatuses.includes("done");
        if (allTerminal && prdStatus !== "done" && prdStatus !== "wontfix") {
          drift.push({
            kind: "prd-status-drift",
            rel,
            detail: `all ${issueStatuses.length} issue(s) are terminal but PRD Status is ${prdStatus}`,
          });
        } else if (!allTerminal && prdStatus === "done") {
          drift.push({ kind: "prd-status-drift", rel, detail: "PRD Status is done but open issues remain" });
        } else if (!allTerminal && anyDone && prdStatus === "ready-for-agent") {
          drift.push({
            kind: "prd-status-drift",
            rel,
            detail: "issues have started landing but PRD Status is still ready-for-agent (should be in-progress)",
          });
        }
      }
    }
  }

  // Non-fatal: merged local branches the lifecycle says to delete.
  const staleBranches = [...mergedBranches].filter((b) => b !== "main" && b !== "master" && b !== currentBranch);
  if (staleBranches.length > 0) {
    console.warn(
      `Warning: ${staleBranches.length} local branch(es) already merged into main should be deleted ` +
        `(git branch -d ${staleBranches.join(" ")})`
    );
  }

  if (drift.length === 0) {
    console.log(`Issue audit clean — ${checked} issue(s) checked, no drift.`);
    process.exit(0);
  }

  console.error(`Issue audit found ${drift.length} drift item(s) across ${checked} issue(s):\n`);
  for (const d of drift) {
    console.error(`  [${d.kind}] ${d.rel}`);
    console.error(`      ${d.detail}`);
  }
  console.error("\nSee docs/agents/issue-tracker.md for the lifecycle loop.");
  process.exit(1);
}

main();
