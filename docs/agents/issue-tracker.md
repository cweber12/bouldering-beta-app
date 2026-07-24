# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `.scratch/`.

## Conventions

- PRDs are grouped by disposition directory:
  - `.scratch/actionable/<domain>-<feature-slug>/`
  - `.scratch/parked/<domain>-<feature-slug>/`
  - `.scratch/done/<domain>-<feature-slug>/`
- The folder name starts with the PRD's primary domain, followed by the feature
  slug. Use the shallow `<disposition>/<domain>-<feature-slug>` shape instead
  of creating domain subdirectories.
- The PRD is `.scratch/<disposition>/<domain>-<feature-slug>/PRD.md`
- Cross-PRD priority and implementation sequence live in `.scratch/ROADMAP.md`.
  The roadmap is the source of truth for ordering work across PRDs; do not try
  to maintain global sequence by duplicating rank fields across every PRD.
- Implementation issues are
  `.scratch/<disposition>/<domain>-<feature-slug>/issues/<NN>-<slug>.md`,
  numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Two more tracking lines are added as an issue moves through implementation, directly under `Status:`:
  - `Branch:` — the branch the work lives on, written when implementation starts (status moves to `in-progress`). Work committed directly to `main` (rare; batch/doc commits) records `Branch: main`.
  - `Merged:` — the commit SHA that landed the work on `main`, written when the issue is closed (status moves to `done`)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

A fully closed issue's tracking block looks like:

```text
Status: done
Branch: feat/gt-03-model-persistence
Merged: 9750b1c
```

A `done` issue must always carry **both** `Branch:` and `Merged:` — the drift
audit fails on a `done` issue missing either.

### PRD status lifecycle

The PRD's own `Status:` line tracks the feature as a whole:

- `ready-for-agent` — no issue has landed yet
- `in-progress` — at least one issue is done, others remain open
- `done` — every issue is terminal (`done` or `wontfix`)

Moving the last issue to `done` and moving the PRD to `done` happen in the same
commit. The drift audit checks PRD/issue consistency.

### PRD disposition and roadmap

PRD actionability is tracked separately from lifecycle:

- `Disposition: actionable` — the PRD may be selected for implementation. Both
  `ready-for-agent` and `in-progress` PRDs live under `.scratch/actionable/`;
  use `Status:` to distinguish them.
- `Disposition: parked` — the PRD is intentionally deferred; do not start work
  from it until the disposition changes.
- `Disposition: done` — the PRD is complete and retained for history.

When a PRD's disposition changes, move the whole PRD folder to the matching
lane, update the PRD's `Disposition:` line in the same commit, and rewrite any
`.scratch/...` references that pointed at the old path. The drift audit checks
that the PRD metadata agrees with its lane.

Use `.scratch/ROADMAP.md` to choose work across PRDs. It groups PRDs by current
planning lane and gives each listed PRD a priority. The PRD's primary domain is
visible in its folder name. If a PRD says `Disposition: parked`, it belongs
under `.scratch/parked/` and the roadmap's parked lane even if its `Status:` is
otherwise `ready-for-agent`.

Roadmap priorities use the following vocabulary:

- `P0` — unblocker or correctness issue that should preempt planned work.
- `P1` — next planned product/build work.
- `P2` — valuable but not sequenced yet.
- `P3` — parked, speculative, or revisit-later work.

### Superseded issues

When a newer PRD replaces an issue rather than implementing it, close it as:

```text
Status: wontfix
Superseded-by: .scratch/<disposition>/<domain>-<new-feature>/issues/<NN>-<slug>.md
```

with a short blockquote note under the tracking block saying what superseded it
and where the spec of record now lives. Never leave two live issues tracking the
same work — the older one gets the pointer. The drift audit verifies the
`Superseded-by:` target exists.

### Batch commits

If one commit lands the work of several issues (a workstream batch), close
**every** covered issue immediately: set `Status: done`, `Branch:`, and
`Merged: <landing sha>` and tick their acceptance checkboxes, in the very next
(chore) commit if the SHA can't be known in advance — never later in the
session. An implementation commit whose issues are left unclosed is
the tracker's primary failure mode — it leaves nothing for the drift audit to
key on. (This is exactly how ten pipeline-audit issues shipped silently before
the 2026-07-17 audit.)

### Acceptance checkboxes

Checkbox state must reflect the implementation at close time: tick the boxes
verified by the quality gate, and note any criterion that shipped differently
(or was exceeded) in `## Comments` instead of leaving it unchecked.

## PRD lifecycle loop

Issues are cut as independently-grabbable vertical slices, so the **unit of work is one issue**, not one PRD. Implement and merge them one at a time, in issue-number order, each on its own short-lived branch:

1. **Branch** off the current `main`. Use a readable `<type>/<slug>` name (`feat/`, `fix/`, `chore/`, `refactor/` — matching the repo's existing convention). Write a `Branch:` line into the issue file and set `Status: in-progress`.
2. **Implement** the issue on that branch.
3. **Quality gate.** Run `npx tsc --noEmit`, `npx eslint .`, and the targeted `npx vitest run` for the change. All must pass before going further.
4. **Confirmation pause.** Stop, show the user the diff and a short summary, and wait for explicit confirmation before merging. This is the review gate.
5. **Merge** into `main` with `git merge --no-ff` (a merge commit per issue keeps a clean "issue N landed here" boundary). In that same step, set the issue's `Status: done` and write `Merged: <sha>` with the merge commit's SHA.
6. **Delete** the issue branch immediately — its durable record is the merge commit plus the closed issue file, so nothing is lost.
7. **Sequence.** Branch the next issue off the now-updated `main`. If an issue genuinely depends on an earlier unmerged one, stack its branch on that branch (the exception, not the model).

Before ending a PRD work session, run the drift audit (`node scripts/audit-issues.mjs`) to confirm no issue is left implemented-but-not-closed or closed-but-unmerged.

## When a skill says "publish to the issue tracker"

Create a new actionable PRD folder under
`.scratch/actionable/<domain>-<feature-slug>/` (creating the directory if
needed), unless the user explicitly asks to park it.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.
