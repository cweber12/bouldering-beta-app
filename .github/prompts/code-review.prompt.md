---
mode: agent
description: >
  Full code-quality review for Bouldering Beta.
  Runs type-check, tests, coverage, and lint; then audits every source file
  for unused variables, stale imports, uncovered modules, and rule violations
  from copilot-instructions.md. Produces a prioritised findings list with
  file links and fix guidance.
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - file_search
  - get_errors
  - semantic_search
---

# Code Review Agent

You are performing a thorough code-quality review of the Bouldering Beta
project. Work through every step below in order. Do not skip steps.

---

## Step 1 — Automated checks

Run all four checks and capture their full output.

```powershell
# Type-check
npx tsc --noEmit

# Tests
npx vitest run

# Coverage
npx vitest run --coverage

# Lint
npx eslint .
```

Summarise the results:
- **TypeScript**: number of errors (target: 0)
- **Tests**: pass/fail counts
- **Coverage**: list every file in `pipeline/`, `hooks/`, `storage/`, `utils/`,
  `components/` that has < 80 % statement coverage or does not appear in the
  report at all
- **Lint**: number of new errors/warnings

---

## Step 2 — Uncovered source files

List every file in `pipeline/` and `hooks/` that has NO corresponding test file
under `__tests__/`. These need tests added.

---

## Step 3 — Unused symbols and stale imports

For every TypeScript source file in `pipeline/`, `hooks/`, `storage/`, `utils/`:

- Report any import that is never referenced in the file body.
- Report any exported symbol that is never imported anywhere in the project.
- Report any declared local variable that is never read.

Do not flag type-only imports that are re-exported.

---

## Step 4 — Rule compliance

Check every `pipeline/` file:
- No React import present.
- Every function that creates an OpenCV object has a `finally` block that
  frees it.
- First parameter is `cv` (or typed as `CV = any`).
- No `async` keyword.

Check every `hooks/` file:
- No direct OpenCV Mat allocation (only calls to `pipeline/` functions).
- `cv` received as a function argument, never read from `window` or `globalThis`.

Check for forbidden patterns:
- `any` used outside `type CV = any` or `type PoseDetector = any`.
- `@ts-ignore` or `@ts-expect-error` directives.
- `console.log` (only `console.info` / `console.warn` / `console.error` allowed).

---

## Step 5 — Security spot-check

- No `dangerouslySetInnerHTML` without sanitisation.
- No `eval()` or `new Function()`.
- Object URLs created via `URL.createObjectURL` are revoked after use.
- No hardcoded secrets or credentials.

---

## Step 6 — Report

Produce a single Markdown report with four sections:

### 🔴 Blocking (must fix before commit)
TypeScript errors, failing tests, lint errors.

### 🟡 Coverage gaps
Files with < 80 % coverage or no test file at all.

### 🟠 Code quality
Unused imports/variables, rule violations, forbidden patterns.

### 🟢 Passed
Everything that was checked and found clean.

For each finding include the file path (as a link), line number if known,
and a one-sentence fix description.
