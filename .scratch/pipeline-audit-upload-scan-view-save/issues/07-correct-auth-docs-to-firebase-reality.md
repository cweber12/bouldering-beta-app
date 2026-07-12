# Correct Auth Documentation to Match Firebase Implementation

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/pipeline-audit-upload-scan-view-save/PRD.md`

## What to build

Update agent-facing and repository documentation where auth is currently described
as Supabase so it matches the implemented Firebase session architecture. This is a
documentation alignment task and should not change runtime auth behavior.

## Acceptance criteria

- [ ] Documentation no longer claims Supabase auth where Firebase is the actual implementation.
- [ ] Updated docs describe route protection and session handling terms consistent with current code.
- [ ] Scope remains documentation-only with no production auth code changes.

## Blocked by

None - can start immediately
