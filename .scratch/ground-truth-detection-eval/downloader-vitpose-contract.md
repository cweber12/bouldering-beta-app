# Downloader task: ViTPose++ Ground Truth scaffold endpoint

Instructions for an agent working in the **downloader repository** (the separate
program that downloads climbing videos into the `analysis/` corpus). beta-scanner
now expects this program to expose a ViTPose++ pose endpoint. The beta-scanner
side is already built (branch `feat/vitpose-gt-scaffold`); this is the other half.

## Why

beta-scanner's detection-eval harness authors per-video **Ground Truth** poses by
letting a human drag a scaffold skeleton into place on sampled frames. Today the
scaffold comes from MediaPipe — the same detector being graded — which is a poor,
self-referential seed. We want the scaffold seeded by **ViTPose++**, a stronger,
independent model. ViTPose is **only a seed**: the human still corrects it and
owns the truth. It runs here (in the downloader) because beta-scanner's pipeline
is browser-bound and can't host a PyTorch model. See `docs/adr/0019` in
beta-scanner for the full rationale.

## What to build

A single async job endpoint that runs top-down ViTPose on the **Climber** and
writes a `vitpose.json` artifact into the video's bundle.

### 1. Endpoint

```
POST /api/vitpose
```

beta-scanner calls this server-to-server (its env var `HARNESS_API_BASE` points at
your program's base URL). Dev-only; no auth beyond being on localhost.

**Request body** (JSON):

```jsonc
{
  "video_path":   "analysis/route-x/vid_1/vid_1.mp4", // relative to your analysis root
  "route_folder": "route-x",   // bundle parent dir
  "video_key":    "vid_1",     // bundle dir
  "climber_point": { "x": 0.5, "y": 0.4 } | null, // tap, video-normalized [0,1]; may be null
  "climber_crop": { "x": 0.05, "y": 0.05, "w": 0.9, "h": 0.9 }, // fractions of frame [0,1]
  "wall_crop":    { "x": 0.05, "y": 0.05, "w": 0.9, "h": 0.9 }, // ignore for pose
  "panning":      false,       // true = moving-camera capture
  "frames": [ { "timestamp": 0.0 }, { "timestamp": 0.4667 }, ... ] // EXACT frames to pose
}
```

**Response:** accept the job and return quickly — `202` (or `200`) with any small
JSON body (e.g. `{ "jobId": "..." }`). beta-scanner only checks that the response
is 2xx, then polls the filesystem for the artifact. Do **not** block until pose is
done. If you can't start (bad path, model unavailable), return `4xx`/`5xx` with
`{ "error": "..." }` — beta-scanner surfaces it.

### 2. The job

1. Resolve `video_path` against your analysis root.
2. **Detect + track people** across the video (e.g. ByteTrack over a person
   detector). ViTPose is top-down and does not find/track people itself.
3. **Select the Climber track** using `climber_point` (and `climber_crop` as a
   fallback region): pick the track whose box contains / is nearest the tap on the
   frame nearest the tap, then follow that track id. This is "Climber Identity" —
   reject other people (spotters, passersby). If `climber_point` is null, fall
   back to the largest/most-central person in `climber_crop`.
4. For **each requested `frames[].timestamp`**, take the Climber track's box on the
   nearest decoded frame and run **ViTPose++** top-down on it.
5. Write `vitpose.json` (below) into `analysis/<route_folder>/<video_key>/`.

A single sequential decode pass is fine: for each decoded frame, if it's the
nearest to an outstanding requested timestamp, pose it. No per-timestamp seeking
required.

### 3. Artifact: `vitpose.json`

Write to `analysis/<route_folder>/<video_key>/vitpose.json`:

```jsonc
{
  "version": 1,
  "frames": [
    {
      "timestamp": 0.0,          // ECHO the requested value exactly (see below)
      "keypoints": [
        { "name": "nose",         "x": 0.51, "y": 0.12, "score": 0.98 },
        { "name": "left_shoulder","x": 0.44, "y": 0.30, "score": 0.95 },
        // ... one object per detected joint
      ]
    },
    { "timestamp": 0.4667, "keypoints": [] } // empty = Climber not tracked here
  ]
}
```

## Critical rules (get these exactly right)

- **Timestamp echo.** Each output `frames[].timestamp` MUST equal the *requested*
  value from the POST, verbatim — not your decoder's actual frame time.
  beta-scanner matches the seed to its Detection Frames within **1 millisecond**,
  so any drift means the frame is treated as having no Climber. Emit **one output
  frame per requested frame**, in the same set (order doesn't matter).
- **Coordinates are video-normalized `[0, 1]`**: `x = pixel_x / frame_width`,
  `y = pixel_y / frame_height`, over the **full frame** (not the crop). Values
  outside `[0,1]` are clamped by beta-scanner, so keep them in range.
- **Keypoint names.** These 13 core joints are what beta-scanner scores; emit them
  with **exactly these names** (COCO-17 already uses them):
  `nose`, `left_shoulder`, `right_shoulder`, `left_elbow`, `right_elbow`,
  `left_wrist`, `right_wrist`, `left_hip`, `right_hip`, `left_knee`, `right_knee`,
  `left_ankle`, `right_ankle`.
  You may also include other points (COCO eyes/ears, etc.) — they're drawn faintly
  as context and ignored by scoring. If your model uses different names (Halpe-26,
  etc.), rename to the above.
- **Confidence matters.** Put the model's real per-keypoint confidence in `score`
  (`[0,1]`). beta-scanner pre-marks joints below ~0.5 as "occluded / needs review"
  — it does **not** drop them. Never omit or thin low-confidence joints or frames;
  every requested frame should get an entry (empty `keypoints` only when the
  Climber genuinely isn't tracked there).
- **Empty vs present.** A frame with a posed Climber → non-empty `keypoints` →
  beta-scanner seeds it `present`. A frame where the tracker had no Climber box →
  `"keypoints": []` → seeded `absent`.

## Validation target

`vitpose.json` must pass beta-scanner's parser (`utils/harnessViTPose.ts →
parseViTPoseScaffold`). It rejects the file (harness shows a 422) if:

- top-level isn't an object, `version` isn't an integer, or `frames` isn't an array
  (≤ 100000 entries);
- any frame's `timestamp` isn't a finite number ≥ 0, or `keypoints` isn't an array;
- any keypoint's `name` is empty, or `x`/`y`/`score` isn't a finite number.

## Edge cases

- **No Climber found at all** (bad tap, wrong person): still write the file with
  all frames present but `keypoints: []`, or your best-effort track — the human
  will catch and correct it. Don't fail the job.
- **Multiple people / Bystanders**: only ever pose the selected Climber track.
- **Tracker loses the Climber mid-clip**: emit `keypoints: []` for the dropped
  frames; re-acquire if the track returns.
- **Panning capture** (`panning: true`): no special handling needed — pose per
  frame as usual; beta-scanner owns the wall alignment.
- **Idempotency**: re-running the job for the same bundle should overwrite
  `vitpose.json`. beta-scanner re-requests on every re-calibration; returning fast
  when a fresh artifact already exists is a fine optimization.

## How to test your side without beta-scanner

1. `POST /api/vitpose` with a small `frames` list for a known bundle.
2. Assert `vitpose.json` appears in the bundle dir, echoes those exact timestamps,
   uses the 13 core joint names, coords in `[0,1]`, and validates against the
   parser rules above.
3. Sanity-check the Climber selection on a clip with a spotter — the posed track
   should be the climber, not the spotter.

## Integration checklist (both repos)

- [ ] Downloader: `POST /api/vitpose` job + tracker + ViTPose + `vitpose.json` writer.
- [x] beta-scanner: request/poll client, dev proxy, harness wiring, seed logic (branch `feat/vitpose-gt-scaffold`).
- [ ] Set beta-scanner's `HARNESS_API_BASE` to the downloader base URL, share `HARNESS_ANALYSIS_ROOT`.
- [ ] End-to-end: calibrate a video in `/dev/harness`, confirm the stepper seeds from ViTPose and `ground-truth.json` saves one record per Detection Frame.
