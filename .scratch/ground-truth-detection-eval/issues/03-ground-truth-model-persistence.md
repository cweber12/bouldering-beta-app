# Ground Truth Model and Bundle Persistence

Status: done
Branch: main
Merged: ee15f57
Type: AFK

## Parent

- `.scratch/ground-truth-detection-eval/PRD.md`

## What to build

The **Ground Truth** data model and its read/write path in the dev proxy. Define `ground-truth.json`: per-Detection-Frame records keyed by frame index/timestamp, each with a state (`present` / `absent` / `skip`), the core body-joint positions (video-normalized), a per-joint `occluded` flag, and a `verified` flag; plus a top-level `groundTruthHash` (content hash) and the core-joint set definition. Add dev-proxy routes to GET and PUT it into the Test Video bundle, mirroring the existing setup route (`app/api/dev/corpus/setup/route.ts`; path-safety via `app/api/dev/shared.ts`), gated on `NODE_ENV === "development"`.

Wire a minimal load/save into the harness so a GT can be persisted and reloaded for a video — the authoring UI comes in issue 04, so here a programmatic/trivial GT round-trips. Keep the type framework-agnostic (no React) in a `pipeline`/`utils` module.

## Acceptance criteria

- [ ] `ground-truth.json` schema defined: per-frame state, core-joint positions, occluded/verified flags, `groundTruthHash`, joint-set definition.
- [ ] Dev-proxy GET/PUT round-trips GT into the correct bundle; unsafe keys and non-dev requests are rejected (mirrors the setup route).
- [ ] `groundTruthHash` changes when GT content changes and is stable otherwise.
- [ ] Route + schema covered by tests.

## Blocked by

None - can start immediately.
