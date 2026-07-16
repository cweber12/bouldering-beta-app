# Video-keyed Ground Truth — setup edits never touch accepted truth

Status: done
Branch: feat/video-keyed-ground-truth
Merged: 0f2a9e1
Type: AFK

## Parent

- `.scratch/calibration-analyze-split/PRD.md`

## What to build

Accepted Ground Truth becomes keyed to the Test Video, not the Scan Setup. The staleness-discard rule (and its "prior truth discarded" notice) is removed; carry-forward re-keys from setupHash-match to **timestamp match** — prior flags land on new grid frames with matching timestamps regardless of setup changes, and new frames arrive auto-accepted (this is also how a sparse legacy grid densifies onto the 100 ms grid). Editing crops/tap/tier/panning on a video with accepted truth skips the ViTPose job and review entirely; an explicit re-seed action re-requests ViTPose on the uniform grid with flags carried forward. `setupHash` stays on `ground-truth.json` purely as seed provenance: schema, canonical hash pre-image, and `GROUND_TRUTH_VERSION` are untouched, so no stored file is rewritten and no migration runs. Label edits keep their existing independent save path.

## Acceptance criteria

- [x] Editing the Scan Setup on a video with accepted Ground Truth triggers no ViTPose request and leaves the truth file untouched.
- [x] Carry-forward is timestamp-keyed: flags survive setup changes and grid densification; no discard path remains in the scaffold util.
- [x] An explicit re-seed action re-runs ViTPose on the uniform grid and carries prior flags forward by timestamp.
- [x] Schema tests pin that hash pre-image, `setupHash` field, and `GROUND_TRUTH_VERSION` are unchanged — video-keying is semantics only.
- [x] Legacy sparse-grid truth files load and carry forward without migration.
- [x] Type-check, lint, and targeted tests pass.

## Blocked by

- `.scratch/calibration-analyze-split/issues/01-uniform-grid-calibration.md`
