# Broaden the Capture-Mode Toggle Label

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/moving-video-displays/PRD.md`

## What to build

Rename the user-facing "Long route (panning)" toggle to a broader term so climbers with
shaky/handheld footage realise the mode applies to them and stop scanning in Fixed mode.
Panning Capture matches each Keyframe independently to the whole photo (ADR-0003), so it
already handles any camera motion — this is a label + copy change only.

- `components/scan/process-flow/StepSetDetection.tsx` — rename "Long route (panning)" to
  a broader term (recommend "Moving camera", subtext "Panning, handheld, or shaky").
  Update the help text to note it covers any camera motion and "Leave off for a fixed
  (tripod) shot."
- `app/docs/page.tsx:214` — update the matching description.
- `CONTEXT.md` — add a one-line clarification to the _Panning Capture_ glossary entry that
  it covers any moving/handheld camera, not only vertical pans (keep "Panning Capture" as
  the canonical domain term; only the UI label broadens). Also refresh _Detection Preview_
  to note it now plays the source video, and note the loading starfield is now live.

Keep the internal `panning` boolean and the `CaptureMode = "fixed" | "panning"`
diagnostics type unchanged. No ADR — the display/label choices here are easily reversible.

## Acceptance criteria

- [ ] The toggle label and help text read as covering panning, handheld, and shaky shots,
      with Fixed described as the tripod case.
- [ ] The docs page description matches the new label.
- [ ] CONTEXT.md's Panning Capture entry is clarified; internal terms/types unchanged.
- [ ] No behavioural change to detection/matching — label and copy only.

## Blocked by

None - can start immediately (independent of issues 01 and 02)
