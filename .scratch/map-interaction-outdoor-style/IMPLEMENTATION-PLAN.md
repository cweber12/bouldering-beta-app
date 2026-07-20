# Implementation Plan: Map Interaction Outdoor Style

> Status: approved for execution
> Scope source: `.scratch/map-interaction-outdoor-style/PRD.md` and issues 01-05 in this folder.
> Execution model: one issue per branch, in issue-number order, merged with `--no-ff`.

## Merge Order

1. Issue 01 - Stabilize Route Map Interaction Contract
2. Issue 02 - Align Profile Map with Stable Viewport Policy
3. Issue 03 - Add Preferred Outdoor Basemap with Automatic Fallback
4. Issue 04 - Keep Climbing Overlay Fast and Bounded
5. Issue 05 - Document Map Provider Strategy and Dataset Scope

This order respects all declared blockers:
- 02, 03, 04 depend on 01.
- 05 depends on 03 and 04.

## Global Rules Per Issue

- Start each issue from current `main`.
- Update the issue header before implementation:
  - Set `Status: in-progress`
  - Add `Branch: <branch-name>`
- Run quality gate before merge:
  - `npx tsc --noEmit`
  - `npx eslint .`
  - `npx vitest run <targeted tests>`
- Pause for human confirmation before merge.
- Merge with `git merge --no-ff`.
- Close issue in same step:
  - Set `Status: done`
  - Add `Merged: <merge-sha>`
- Delete the issue branch after merge.

## Issue 01 Checklist

Issue: `.scratch/map-interaction-outdoor-style/issues/01-stabilize-route-map-interaction-contract.md`
Branch: `fix/map-01-route-map-interaction-contract`

### Start

```powershell
git checkout main
git pull
git checkout -b fix/map-01-route-map-interaction-contract
```

### Issue tracking header update

- `Status: in-progress`
- `Branch: fix/map-01-route-map-interaction-contract`

### Suggested targeted tests

```powershell
npx vitest run __tests__/components/map/ClimbsMap.test.tsx __tests__/components/routes/RoutesView.test.tsx
```

### Quality gate

```powershell
npx tsc --noEmit
npx eslint .
npx vitest run __tests__/components/map/ClimbsMap.test.tsx __tests__/components/routes/RoutesView.test.tsx
```

### Merge sequence

```powershell
git checkout main
git pull
git merge --no-ff fix/map-01-route-map-interaction-contract
```

Record merge SHA in issue 01, then:

```powershell
git add .
git commit -m "chore: close issue 01 tracker state"
git push
git branch -d fix/map-01-route-map-interaction-contract
```

## Issue 02 Checklist

Issue: `.scratch/map-interaction-outdoor-style/issues/02-align-profile-map-viewport-policy.md`
Branch: `fix/map-02-profile-map-viewport-policy`

### Start

```powershell
git checkout main
git pull
git checkout -b fix/map-02-profile-map-viewport-policy
```

### Issue tracking header update

- `Status: in-progress`
- `Branch: fix/map-02-profile-map-viewport-policy`

### Suggested targeted tests

```powershell
npx vitest run __tests__/components/map/ClimbsMap.test.tsx __tests__/app/profile/page.test.tsx
```

### Quality gate

```powershell
npx tsc --noEmit
npx eslint .
npx vitest run __tests__/components/map/ClimbsMap.test.tsx __tests__/app/profile/page.test.tsx
```

### Merge sequence

```powershell
git checkout main
git pull
git merge --no-ff fix/map-02-profile-map-viewport-policy
```

Record merge SHA in issue 02, then:

```powershell
git add .
git commit -m "chore: close issue 02 tracker state"
git push
git branch -d fix/map-02-profile-map-viewport-policy
```

## Issue 03 Checklist

Issue: `.scratch/map-interaction-outdoor-style/issues/03-add-outdoor-basemap-with-fallback.md`
Branch: `feat/map-03-outdoor-basemap-fallback`

### Start

```powershell
git checkout main
git pull
git checkout -b feat/map-03-outdoor-basemap-fallback
```

### Issue tracking header update

- `Status: in-progress`
- `Branch: feat/map-03-outdoor-basemap-fallback`

### Suggested targeted tests

```powershell
npx vitest run __tests__/utils/leaflet.test.ts __tests__/components/map/ClimbsMap.test.tsx
```

### Quality gate

```powershell
npx tsc --noEmit
npx eslint .
npx vitest run __tests__/utils/leaflet.test.ts __tests__/components/map/ClimbsMap.test.tsx
```

### Merge sequence

```powershell
git checkout main
git pull
git merge --no-ff feat/map-03-outdoor-basemap-fallback
```

Record merge SHA in issue 03, then:

```powershell
git add .
git commit -m "chore: close issue 03 tracker state"
git push
git branch -d feat/map-03-outdoor-basemap-fallback
```

## Issue 04 Checklist

Issue: `.scratch/map-interaction-outdoor-style/issues/04-keep-climbing-overlay-fast-and-bounded.md`
Branch: `feat/map-04-overlay-bounds-caching`

### Start

```powershell
git checkout main
git pull
git checkout -b feat/map-04-overlay-bounds-caching
```

### Issue tracking header update

- `Status: in-progress`
- `Branch: feat/map-04-overlay-bounds-caching`

### Suggested targeted tests

```powershell
npx vitest run __tests__/components/map/ClimbsMap.test.tsx
```

### Quality gate

```powershell
npx tsc --noEmit
npx eslint .
npx vitest run __tests__/components/map/ClimbsMap.test.tsx
```

### Merge sequence

```powershell
git checkout main
git pull
git merge --no-ff feat/map-04-overlay-bounds-caching
```

Record merge SHA in issue 04, then:

```powershell
git add .
git commit -m "chore: close issue 04 tracker state"
git push
git branch -d feat/map-04-overlay-bounds-caching
```

## Issue 05 Checklist

Issue: `.scratch/map-interaction-outdoor-style/issues/05-document-map-provider-and-dataset-scope.md`
Branch: `chore/map-05-doc-provider-dataset-scope`

### Start

```powershell
git checkout main
git pull
git checkout -b chore/map-05-doc-provider-dataset-scope
```

### Issue tracking header update

- `Status: in-progress`
- `Branch: chore/map-05-doc-provider-dataset-scope`

### Suggested targeted tests

```powershell
npx vitest run __tests__/components/map/ClimbsMap.test.tsx
```

### Quality gate

```powershell
npx tsc --noEmit
npx eslint .
npx vitest run __tests__/components/map/ClimbsMap.test.tsx
```

### Merge sequence

```powershell
git checkout main
git pull
git merge --no-ff chore/map-05-doc-provider-dataset-scope
```

Record merge SHA in issue 05, then:

```powershell
git add .
git commit -m "chore: close issue 05 tracker state"
git push
git branch -d chore/map-05-doc-provider-dataset-scope
```

## Session Close Audit

After issue 05 lands:

```powershell
node scripts/audit-issues.mjs
```

Resolve any drift the audit reports before ending the session.

## Notes

- If targeted test files do not exist yet, create them as part of the issue and keep the same quality-gate shape.
- If unrelated baseline warnings or failures appear, note them in issue comments and avoid masking them with broad excludes.
- Update the PRD `Status:` to `in-progress` when the first issue is merged, and to `done` when all issues reach terminal state.
