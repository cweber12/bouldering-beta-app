# Read-Only Reviewer and One-Button Accept

Status: done
Branch: feat/cfr-03-readonly-reviewer-accept
Merged: eb4c07c
Type: AFK

## Parent

- `.scratch/calibration-flag-review/PRD.md`

## What to build

Replace the landmark-correction editor with a read-only Ground Truth reviewer, and per-frame validation with a single accept action:

- The Edit-Ground-Truth mode toggle survives, but the mode now renders a **read-only viewer**: the paused video frame with the ViTPose seed skeleton, core joints highlighted, occluded joints rendered hollow, zoom/pan retained for inspecting small joints in portrait video. No pointer editing of any kind — dragging, joint placement/removal, whole-pose translate, occlusion toggling, and the per-frame Accept-as-is button are all removed, along with their geometry helpers and tests. Preview mode keeps showing the detection under test; review mode shows the seed being attested.
- A per-frame three-way **[ Auto | Wrong | Absent ]** control drives the flag helper from the scaffold utils.
- One **Accept & save Ground Truth** button persists `ground-truth.json` — every frame `verified: true`, unflagged frames `review: "auto"`, flagged frames carrying their flag, top-level `setupHash` from the ViTPose artifact (falling back to the setup save's returned hash for legacy artifacts without one). Saving shows a confirmation and stays on the page; re-flagging and re-saving is allowed and produces a new `groundTruthHash`. Back to corpus remains a separate action.

## Acceptance criteria

- [ ] Review mode shows the seed skeleton read-only with hollow occluded joints and working zoom/pan; no pointer-editing surface remains anywhere.
- [ ] Each frame has the three-way flag control; flags round-trip through save and reload.
- [ ] One Accept & save button persists the full file with correct `review`/`verified`/`setupHash`; the page stays put and allows re-flag + re-save.
- [ ] The drag/place/translate/occlusion editing code and its tests are deleted, not disabled.
- [ ] Covered by tests at the reviewer-component seam (jsdom + Testing Library, replacing the old editor component test).

## Blocked by

- `.scratch/calibration-flag-review/issues/02-auto-accept-scaffold-helpers.md`
