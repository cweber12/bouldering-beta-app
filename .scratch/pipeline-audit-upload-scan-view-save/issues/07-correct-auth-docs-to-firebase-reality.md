# Correct Auth Documentation to Match Firebase Implementation

Status: done
Branch: main
Merged: b5e3d64
Type: AFK

## Parent

- `.scratch/pipeline-audit-upload-scan-view-save/PRD.md`

## What to build

Update agent-facing and repository documentation where auth is currently described
as Supabase so it matches the implemented Firebase session architecture. This is a
documentation alignment task and should not change runtime auth behavior.

## Acceptance criteria

- [x] Documentation no longer claims Supabase auth where Firebase is the actual implementation.
- [x] Updated docs describe route protection and session handling terms consistent with current code.
- [x] Scope remains documentation-only with no production auth code changes.

## Blocked by

None - can start immediately

## Comments

- 2026-07-17 (tracker audit): closed retroactively — landed in b5e3d64 (workstream C). AGENTS.md/CLAUDE.md now describe the Firebase session-cookie architecture; the only remaining Supabase mention is the intentional no-Supabase note.
