# Post Analyze run append-only with attribution stamps

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/analyze-action-production-run/PRD.md`

## What to build

Post each completed Analyze run once through the detections relay as append-only evidence, stamped with `appVersion` and `setupHash`. Add idempotent posting guards so state churn cannot double-post the same run, and refresh corpus run counts after successful post.

## Acceptance criteria

- [ ] One completed Analyze run produces one relay POST.
- [ ] Relay payload carries `appVersion` and `setupHash` stamps.
- [ ] Relay posting remains append-only with no mutation of historical runs.
- [ ] Corpus run count refreshes after successful post.
- [ ] Type-check, lint, and targeted tests pass.

## Blocked by

- `.scratch/analyze-action-production-run/issues/01-analyze-run-orchestration.md`
