# Canonize the issue template and extend the drift audit

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-conventions-and-enforcement/PRD.md`

## Blocked by

Nothing. Independent of issue 01 and of every code issue in this PRD.

## What to build

`docs/agents/issue-tracker.md` documents the `Status:` / `Branch:` / `Merged:` metadata but no
body template, even though 115 of 122 issue files share one. The undocumented `Type:` line carries
five values for two concepts and is absent from 41 issues. Correct the doc to match reality, then
give the drift audit something to key on.

**Document the body template** in `docs/agents/issue-tracker.md`, descriptively — this is
recording what the repo already does, not imposing a new shape. The observed sections, with their
current usage counts:

```text
# <Title>

Status: <triage role>
Type: agent | interactive

## Parent          (115/122)
## Blocked by      (90/122)
## What to build   (115/122)
## Acceptance criteria   (114/122, checkboxes)
## Comments        (47/122, appended over time)
```

Note that `## User stories covered` (31), `## Target metrics` (6), and similar sections are
optional additions, not part of the required skeleton.

**Document and collapse `Type:`.** It answers a question `Status:` cannot: `Status:` is lifecycle,
so once an issue moves to `in-progress` it no longer says whether a human has to be at the
keyboard. Close the vocabulary to two values:

- `agent` — an unattended agent can complete this end to end. Absorbs the 72 `AFK` and the 1
  `agent` already in use.
- `interactive` — needs a human in the loop. Absorbs the 6 `interactive` and the 1 `HITL`.

The single `AFK + external` issue becomes `Type: agent` plus a `## Blocked by` entry naming the
external dependency — the blocker belongs in a section, not smuggled into a metadata value.

**Extend `scripts/audit-issues.mjs`** with a new drift kind covering: a missing or non-vocabulary
`Type:` line, and a missing `## Parent`, `## What to build`, or `## Acceptance criteria` heading.
Scope it to issues under `.scratch/actionable/` and `.scratch/parked/` only — `done/` is history
and rewriting it would be dishonest about what those issues looked like when they landed. Follow
the existing drift-kind structure in the script; it already exits 1 on any drift.

**Backfill the open stragglers** so the new check passes. Sixteen issues need work:

- All 9 under `.scratch/actionable/scan-pipeline-isolation-testability/issues/` — missing `Type:`
  only. These are all unattended-agent refactor slices: `Type: agent`.
- All 7 under `.scratch/actionable/pose-vitpose-climber-identity/issues/` — missing `Type:` and
  also `## Parent` / `## What to build` (issue 03 additionally lacks `## Acceptance criteria`).
  These use a different body shape from the other 115; restructure them into the canonical
  skeleton without changing their substance, and read each one's existing content to decide
  `agent` vs `interactive` rather than defaulting.

Add an `audit:issues` script to `package.json` pointing at `node scripts/audit-issues.mjs`. Do
**not** add it to `.github/workflows/ci.yml` — AGENTS.md already makes running it a
session-completion gate, and CI has no view of the local branch state several of its checks read.

The issues authored for this PRD and for `arch-consolidation-cleanup` already use the target
`Type:` vocabulary, so they need no backfill.

## Acceptance criteria

- [ ] `docs/agents/issue-tracker.md` documents the required body skeleton (`## Parent`,
      `## Blocked by`, `## What to build`, `## Acceptance criteria`, `## Comments`) and notes that
      other sections are optional.
- [ ] `docs/agents/issue-tracker.md` documents `Type:` with exactly two values, `agent` and
      `interactive`, and explains what it carries that `Status:` does not.
- [ ] `scripts/audit-issues.mjs` reports drift for a missing or non-vocabulary `Type:` line and
      for a missing `## Parent`, `## What to build`, or `## Acceptance criteria` heading.
- [ ] The new check applies to `actionable/` and `parked/` issues only; `done/` issues are not
      flagged and not modified.
- [ ] All 9 `scan-pipeline-isolation-testability` issues carry `Type: agent`.
- [ ] All 7 `pose-vitpose-climber-identity` issues carry a `Type:` line chosen per issue and use
      the canonical skeleton, with their existing substance preserved.
- [ ] No `AFK`, `HITL`, or `AFK + external` value remains in any `actionable/` or `parked/` issue.
- [ ] `package.json` has an `audit:issues` script; `.github/workflows/ci.yml` is unchanged.
- [ ] `npm run audit:issues` exits clean across the whole `.scratch/` tree.
- [ ] `npx vitest run __tests__/scripts/` passes.
