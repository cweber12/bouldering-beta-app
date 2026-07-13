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

/** Collect every issue markdown file under .scratch/<feature>/issues/. */
function findIssueFiles() {
  const files = [];
  if (!existsSync(SCRATCH)) return files;
  for (const feature of readdirSync(SCRATCH, { withFileTypes: true })) {
    if (!feature.isDirectory()) continue;
    const issuesDir = join(SCRATCH, feature.name, "issues");
    if (!existsSync(issuesDir)) continue;
    for (const entry of readdirSync(issuesDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(join(issuesDir, entry.name));
      }
    }
  }
  return files;
}

function main() {
  const mergedBranches = new Set(
    git("branch --merged HEAD")
      .split("\n")
      .map((b) => b.replace(/^[*+]?\s*/, "").trim())
      .filter(Boolean)
  );
  // Recent main history subjects, to spot branches that merged then got deleted.
  const historyText = git("log --oneline -n 1000");

  const drift = [];
  let checked = 0;

  for (const file of findIssueFiles()) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    const text = readFileSync(file, "utf8");
    const status = (readField(text, "Status") || "").toLowerCase();
    const branch = readField(text, "Branch");
    const merged = readField(text, "Merged");
    if (!status) continue;
    checked++;

    if (status === "done") {
      if (!merged) {
        drift.push({ kind: "closed-but-unmerged", rel, detail: "Status: done but no Merged: sha recorded" });
      } else if (!isAncestor(merged)) {
        drift.push({ kind: "closed-but-unmerged", rel, detail: `Merged: ${merged} is not an ancestor of main` });
      }
      continue;
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
