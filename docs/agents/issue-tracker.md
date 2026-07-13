# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Two more tracking lines are added as an issue moves through implementation, directly under `Status:`:
  - `Branch:` — the branch the work lives on, written when implementation starts (status moves to `in-progress`)
  - `Merged:` — the commit SHA that landed the work on `main`, written when the issue is closed (status moves to `done`)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

A fully closed issue's tracking block looks like:

```text
Status: done
Branch: feat/gt-03-model-persistence
Merged: 9750b1c
```

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

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.
