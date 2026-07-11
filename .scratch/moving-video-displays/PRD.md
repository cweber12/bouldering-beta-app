# PRD: Moving-Video Scan Displays — Loading & Preview Alignment

Status: ready-for-agent

## Problem Statement

Detection and route-photo matching already work well on moving videos — a full-route
Route Overlay lines the skeleton up on the wall correctly. The failure is purely in the
two *intermediate* display surfaces shown during and immediately after a scan, which do
not reflect camera motion and therefore look broken even though the underlying data is
sound:

1. **Loading screen** (`XrayStage`, fed by `useVideoProcessor`) draws a live pose
   skeleton over an ORB "starfield" that is extracted **once** from the first pose frame
   (`orbPreviewSent` guard, `hooks/useVideoProcessor.ts:676`) and never updates. As the
   camera moves the wall dots stay frozen at frame-0 positions while the skeleton moves,
   so the two visibly diverge.
2. **Detection Preview** (`StepViewLandmarks`, and the dev `app/dev/harness` Calibrator)
   draws the per-frame skeleton over a **single frozen first video frame**
   (`firstFrameFile`). As the climber ascends and the camera moves, the skeleton walks
   off the stale background image.

There is also a naming problem: the "Long route (panning)" toggle is labelled too
narrowly. Panning Capture matches each Keyframe independently to the whole photo
(ADR-0003), so it already handles any camera motion — handheld drift, shake, following
the climber — not just a vertical pan up a wall. Users with shaky/handheld footage do
not realise the mode applies to them and scan in Fixed mode, where the single frame-0
homography drifts.

## Solution

A display-only pass on the scanning surfaces. No change to detection, tracking, or the
Route Overlay.

1. **Live-updating loading starfield** — re-emit the wall ORB field on a throttled
   cadence during the seek loop so the dots scroll with the wall and stay coherent with
   the live skeleton.
2. **Video-backed Detection Preview** — play the real source video underneath the
   per-frame skeleton (in both the user flow and the dev harness) instead of a frozen
   first frame, so the overlay always sits on real footage.
3. **Broaden the capture-mode label** — rename the toggle to a broader term (e.g.
   "Moving camera") with copy that covers panning, handheld, and shaky shots, so people
   stop scanning moving videos in Fixed mode.

## User Stories

1. As a climber, I want the loading screen's wall dots to move with the camera, so the
   scan looks like it is tracking the wall rather than frozen.
2. As a climber, I want the loading skeleton and the wall keypoints to stay aligned as
   the camera moves, so I trust the scan is working.
3. As a climber, I want the after-scan preview to show my climb over the moving footage,
   so the skeleton sits on my body through the whole climb, not just the first frame.
4. As a climber, I want to play and seek that preview, so I can review the traced climb
   frame by frame on the real video.
5. As a climber with a shaky or handheld video, I want the capture toggle to tell me it
   applies to me, so I pick the right mode instead of drifting in Fixed mode.
6. As a developer, I want the harness Detection Preview to play the corpus video, so I
   can evaluate detection against real motion.
7. As a maintainer, I want the starfield re-extraction to be throttled and reuse frames
   already captured, so scanning does not slow down.
8. As a maintainer, I want the video-background path added to FramePlayer without
   disturbing the existing static-image path, so Route Overlay and Compare are unaffected.

## Implementation Decisions

- Keep the abstract x-ray aesthetic on the loading screen; only make the starfield live.
  Do not add a video background there.
- Reuse the existing display-only `extractWallFeaturePoints` (climber-masked, normalised
  output) and the `orbPreview`/`setOrbPreview` channel; `XrayStage` already rebuilds the
  starfield layer idempotently on change.
- Throttle the starfield re-emit to a display cadence (~1–2 Hz of processed time), reuse
  the periodic frame `ImageData` already captured on the `POSE_REANALYSIS_INTERVAL`
  cadence, and reuse Panning-mode keyframe wall ORB where present. The display extraction
  never feeds matching, so its feature count may be reduced if cost is high.
- Add an optional video-background source to `FramePlayer`, drawn via
  `requestVideoFrameCallback` and synced to the timestamp-keyed skeleton frames; leave
  the `imageFile` → `createImageBitmap` path untouched for Route Overlay and Compare.
- Keep the source video that both surfaces already retain (`pendingFile`/
  `videoPreviewUrl` in scan; `videoFile`/`videoUrl` in the harness); no re-loading.
- The rename is UI label + copy only. Keep the internal `panning` boolean and the
  `CaptureMode = "fixed" | "panning"` diagnostics type. Keep "Panning Capture" as the
  canonical domain term in CONTEXT.md, adding a clarification that it covers any
  moving/handheld camera.

## Testing Decisions

- Extend `XrayStage` tests to assert the starfield re-renders when `orbPreview` changes.
- Extend `useVideoProcessor` tests to assert the throttled re-emit cadence (ORB mocked at
  the module boundary per repo testing rules).
- Extend `FramePlayer` tests to assert the video-background path draws video frames and
  keeps the skeleton aligned, while the static-image path is unchanged.
- Manual verification on a moving/handheld video, a fixed/tripod video (no regression),
  and the harness Calibrator.

## Out of Scope

- The underlying pose detection, climber tracking, and Route Overlay homography placement.
- Panorama/mosaic stitching of keyframes into a single route image (rejected in favour of
  playing the real video).
- Renaming the internal `panning` boolean or the `CaptureMode` diagnostics type, and
  renaming the "Panning Capture" domain term.

## Further Notes

- Once the starfield is live, the loading skeleton (normalised video space) and the
  starfield (same space) move together frame-to-frame — no homography is needed on the
  loading screen, which is correct since it renders the video's own frame, not a route
  projection.
- These are easily reversible display choices, so no ADR is warranted (per the domain-doc
  rules); CONTEXT.md glossary gets a small clarification only.
- See `docs/adr/0003-panning-capture-keyframe-photo-alignment.md` for the capture-mode
  decision and `CONTEXT.md` for the domain glossary (Fixed Capture, Panning Capture,
  Keyframe, Detection Preview, Route Overlay).
