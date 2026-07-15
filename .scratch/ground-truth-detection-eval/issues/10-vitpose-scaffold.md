# ViTPose++ Ground Truth Scaffold

Status: done
Type: AFK + external
Merged: 0453740

## Parent

- `.scratch/ground-truth-detection-eval/PRD.md`
- Spec: `docs/adr/0019-vitpose-ground-truth-scaffold.md`

## What to build

Seed Ground Truth authoring from a **stronger reference model (ViTPose++)** run on
the downloader, instead of the MediaPipe scaffold. The human stays the truth
authority — ViTPose is only a better starting guess, and being a *different* model
than the detector under test breaks the self-reference on unverified frames.

Two halves:

### beta-scanner side (this branch, `feat/vitpose-gt-scaffold`)

- `utils/harnessViTPose.ts` — the `vitpose.json` contract (`ViTPoseScaffold`,
  `ViTPoseKeypoint`, `ViTPoseRequest`), a name remap to MediaPipe topology
  (`viTPoseToPoseFrames`), a validator (`parseViTPoseScaffold`), and the client
  (`requestViTPoseScaffold` / `loadViTPose`).
- `app/api/dev/corpus/vitpose/route.ts` — dev-only proxy: `POST` relays the
  Climber selection to the downloader (`harnessApiBase()`), `GET` reads back
  `vitpose.json` (null while the job runs, 422 if malformed).
- `app/dev/harness/page.tsx` — on confirm, kick off the ViTPose job (async), poll
  for the artifact, and seed the draggable Ground Truth from the ViTPose poses.
  MediaPipe still runs to establish the Detection Frame grid, and **falls back to
  seeding the scaffold** when the ViTPose job fails or no downloader is configured
  — so 05/08/09 and authoring are not blocked on the external endpoint.
- `utils/harnessGroundTruthScaffold.ts` — `buildGroundTruthScaffold` now keys
  present/absent off whether the scaffold posed the frame, not MediaPipe's status;
  `occluded` seeds from ViTPose confidence via the existing `kp.score` path.

### Downloader side (external — the open dependency)

- A `POST /api/vitpose` endpoint accepting `{ video_path, route_folder,
  video_key, climber_point, climber_crop, wall_crop, panning, frames }` that runs
  an async job: person detect + **track** (hold Climber Identity from
  `climber_point`, e.g. ByteTrack), ViTPose++ top-down on the selected Climber
  track's box for **each requested `frames[].timestamp`**, writing `vitpose.json`
  (one frame per requested timestamp, **echoing that timestamp verbatim**, with
  per-keypoint confidence, coords video-normalized `[0,1]`, MediaPipe-compatible
  core-joint names) into the bundle.
- **Full handoff spec:** `.scratch/ground-truth-detection-eval/downloader-vitpose-contract.md`.

## Acceptance criteria

- [x] `vitpose.json` contract + remap + validator, unit-tested.
- [x] Dev proxy `GET`/`POST` with path-safety, non-dev 404, GET-null-while-pending, malformed-422; tested.
- [x] Harness seeds Ground Truth from ViTPose poses; occluded pre-seeded from confidence; issue 07 no-scored-run invariant preserved.
- [x] Downloader `POST /api/vitpose` job writes `vitpose.json` for a real bundle (external repo).
- [x] End-to-end: calibrate a video, drag ViTPose-seeded landmarks, save `ground-truth.json` (one record per Detection Frame).

## Blocked by

- `.scratch/ground-truth-detection-eval/issues/04-landmark-correction-editor.md`
- `.scratch/ground-truth-detection-eval/issues/05-ground-truth-frame-states-occlusion.md`
- Downloader ViTPose endpoint (external repo).
