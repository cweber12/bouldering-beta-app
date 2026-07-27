# Docs: glossary terms and the climb-window ADR

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/dev-harness-review-surfaces/PRD.md`
- Depends on: issues 04 and 05 (the decisions it records)

## What to build

### CONTEXT.md glossary

Three terms are load-bearing across the harness and defined nowhere. One of them
is already cited as a glossary anchor by a live PRD
(`harness-contract-adr0007-adoption` lists `**Bundle**`), so the reference is
currently dangling.

- **Bundle** — the per-**Test Video** directory the external program owns,
  holding that video's **Scan Setup**, **Ground Truth**, ViTPose scaffold,
  posted runs and evaluations. It is the unit a calibration, a run and a review
  are all scoped to. *Avoid*: batch (a batch is a sweep over many Bundles),
  folder, fixture.
- **Seed tap** — the tap that tells the ViTPose scaffold which tracked person is
  the **Climber**. Deliberately distinct from the **Scan Setup**'s
  `climberPoint`, which seeds MediaPipe and marks where the climb starts; the
  Seed tap is excluded from `setupHash` so re-seeding never re-pairs prior runs.
  *Avoid*: setup tap, analysis tap, climber point.
- **Climb Window** — the bounded span of a **Test Video** the climb occupies,
  from the setup tap's time to the end-of-climb marker. Both bounds are off-hash.
  Open on either side when unmarked, which is not an error state. *Avoid*: clip
  start/end, trim.

Add **Run Review** only if the surface built in issue 02 earns a name of its own
in the ubiquitous language — do not add a term for a component.

Glossary entries only: what the term means and what not to call it. No field
names, file paths or implementation detail — that belongs in the ADRs and the
PRD.

### New ADR — climb-window authoring moves into Ground Truth review

Clears the bar on all three counts:

- **Hard to reverse** — it deletes a corpus-wide sweep shipped days earlier and
  relocates where a ninety-Bundle backlog is worked.
- **Surprising without context** — a future reader will ask why a window that
  demonstrably shapes Ground Truth is authored *after* that truth is accepted.
- **A real trade-off** — three options were genuinely available:
  mark-then-flag-for-re-seed (chosen), re-seed-on-mark, and treat the window as
  purely a downstream scoring bound.

Record the asymmetry that forces the decision: the ViTPose job windows its
tracking history before stitching and skips posing out-of-window frames, so the
window shapes truth content — while the scanner's own scoring never references
the window at all. Record why re-seed-on-mark was rejected (a GPU job per marker
tweak makes browsing unusable, against an off-hash marker whose whole virtue is
being cheap to write), and why scoring-only was rejected (it contradicts the
job's behaviour and would leave the corpus a silent mix of windowed and
unwindowed truth).

Follow the numbering and format of the existing `docs/adr/` files — and note
that the directory currently has **two files numbered 0014**, so check the next
free number rather than incrementing the highest title.

### Tracker and README

- Amend `.scratch/actionable/harness-contract-adr0007-adoption/PRD.md` and its
  issue 02 to record that the `ClimbEndSweeper` is superseded here, with a
  pointer to issue 05, per the tracker's supersession convention.
- Update `README.md` only if the Review surface is user-visible enough to list.
  It is dev-harness-only and `HARNESS_ENABLED`-gated, so most likely it is not —
  make that call explicitly rather than by omission.

## Acceptance criteria

- [ ] **Bundle**, **Seed tap** and **Climb Window** are defined in
      `CONTEXT.md` with *Avoid* lists, in the file's existing format.
- [ ] No implementation detail leaked into the glossary.
- [ ] The dangling `**Bundle**` reference in the ADR-0007-adoption PRD now
      resolves.
- [ ] A new ADR records the climb-window relocation, the rejected alternatives
      and the truth-shaping asymmetry, at the next genuinely free number.
- [ ] The superseded sweep is marked as such in the ADR-0007-adoption PRD and
      its issue 02.
- [ ] The README call is made explicitly.
