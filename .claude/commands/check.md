Run the full post-change checklist in order and report a one-line summary for each step:

1. `npx tsc --noEmit` — report error count (target: 0)
2. `npx vitest run` — report pass/fail counts
3. `npx vitest run --coverage` — list every file in `pipeline/` or `hooks/` that is below 80% statement coverage or does not appear in the report at all
4. `npx eslint .` — report error and warning counts

If all four steps pass (zero TypeScript errors, all tests green, no lint errors):
- Stage all changes: `git add .`
- Commit with an appropriate conventional commit message
- Push: `git push`

If any step fails, report what failed and stop — do not commit.
