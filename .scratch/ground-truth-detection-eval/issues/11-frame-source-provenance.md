# Frame Source Provenance Export

Status: done
Type: agent
Branch: fix/corpus-frame-source-provenance
Merged: 917bfa0

## Parent

- `.scratch/ground-truth-detection-eval/PRD.md`
- Handoff: `C:\tmp\scanner-corpus-update-handoff.md`

## What to build

Export per-frame pose provenance so the external corpus harness can distinguish
raw detector evidence from inferred pose continuity. The scanner's detection run
payload must carry `frames[].source` for every exported pose frame.

Accepted values:

- `raw` - accepted detector output
- `interpolated` - dense pose produced between detector anchors
- `filled` - persistent gap fill contributed inferred joints
- `flipDiscarded` - detector frame was rejected by flip handling
- `limbExpanded` - accepted detector frame used missing-limb crop expansion

## Acceptance Criteria

- [x] `PoseFrame` exposes a typed `source` field with the accepted values.
- [x] Raw detector frames, flip-discarded samples, interpolation output, persistent fills, and limb-expanded accepted frames are tagged.
- [x] Harness detection payloads include the source-tagged frames without schema stripping.
- [x] Unit tests cover representative source assignment and preservation.
- [x] Type-check, lint, targeted tests, and issue drift audit pass.

## Comments

- Corpus Analyze now posts dense source-tagged frames while scoring remains
  limited to raw detector-evidence frames, preserving probed-frame scoring
  semantics.

## Watch-outs

- `heldPose` in the harness is not scanner-failure evidence by itself.
- Missing source is unknown to the harness, not raw; this scanner path should emit
  source for every newly generated frame.
