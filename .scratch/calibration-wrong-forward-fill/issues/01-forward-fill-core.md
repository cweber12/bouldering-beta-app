# Forward-fill core: two-state segment model, fresh-authoring path

Status: in-progress
Branch: feat/wff-01-forward-fill-core

## Parent

`.scratch/calibration-wrong-forward-fill/PRD.md`

## What to build

The tracer bullet for forward-fill Ground Truth review, on the fresh-authoring
path (a Test Video with no prior truth). Marking a Detection Frame **Wrong**
plants a control point that paints every following frame Wrong; marking **Auto**
plants a control point that carries Auto forward — each frame's effective flag is
*derived* from the nearest preceding control point, so the author flags a
wrong-person stretch of any length in two clicks.

End-to-end through every layer:

- **Scaffold utils** — `ReviewFlag` becomes `"auto" | "wrong"`; `reviewToFlag`
  maps the deprecated `human-flagged-absent` and `human` → `"auto"`;
  `applyReviewFlag` goes two-state (the `absent` case is deleted). A new pure
  derivation takes the control-point set + the seed frames and returns each
  frame's effective flag as the value of the nearest preceding control point
  (default `auto`), then applies the **empty-joint exception**: a Detection Frame
  the seed posed nobody at (0 core joints) is always `state: "absent"` /
  `review: "auto"` regardless of any Wrong segment over it, and a Wrong stretch
  bridges across it rather than terminating.
- **Reviewer** — the Absent button is removed (only Auto / Wrong remain); the
  Wrong control is disabled on a zero-joint frame.
- **Page** — working state is the control-point set; clicking a flag plants a
  control point at the seeked frame and re-derives the fill live. Accept & save
  materializes segments → flat per-frame `review` (seeded frames in a Wrong
  segment → `human-flagged-wrong` with `state: "present"` and their seed joints
  kept; every other frame → `auto` with `state` from the seed) and stamps
  `verified: true`.
- **Filmstrip** — no new visualization here; the existing per-frame dot mechanism
  already renders `flagged-wrong` / `seeded-absent`, which is enough to show the
  fill for this slice.

Persisted schema, `GROUND_TRUTH_VERSION`, and the canonical hash pre-image are
unchanged — only the values the UI produces change. Clearing a single Wrong
stretch falls out for free: marking Auto at its start fills Auto forward.

Reopening / re-seeding a video (carry-forward reconstruction, the carry-forward
guard, reset-to-seed) is **out of scope for this slice** — it lands in issue 02.

## Acceptance criteria

- [x] `ReviewFlag` is `"auto" | "wrong"`; the `absent` member and the
      `applyReviewFlag` absent case are gone; `reviewToFlag` returns `"auto"` for
      `human-flagged-absent`, `human`, and `auto`.
- [x] A pure derivation maps a control-point set + seed frames to each frame's
      effective flag via nearest preceding control point, with the empty-joint
      exception (zero-joint frames stay seeded-absent; Wrong bridges across them).
- [x] The reviewer renders only Auto and Wrong controls and disables Wrong on a
      zero-joint frame.
- [x] Marking Wrong on a seeded frame fills every following frame Wrong until an
      Auto control point; marking Auto does the inverse; the fill updates live.
- [x] Accept & save materializes the segments to per-frame `review`
      (`human-flagged-wrong` on seeded Wrong frames with joints kept; `auto`
      elsewhere with `state` from the seed) and stamps `verified: true`.
- [x] No code path emits `human-flagged-absent`.
- [x] ADR 0018 is amended to describe the forward-fill review model.
- [x] Scaffold-module unit tests cover derivation, the empty-joint exception,
      two-state `applyReviewFlag`, and `reviewToFlag`; the reviewer component
      test asserts two controls and Wrong-disabled-on-empty. `npx tsc --noEmit`,
      `npx eslint .`, and the targeted `npx vitest run` pass.

## Blocked by

None - can start immediately.
