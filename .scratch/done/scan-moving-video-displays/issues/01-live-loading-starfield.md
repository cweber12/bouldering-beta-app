# Live-Updating Loading Starfield

Status: done
Branch: main
Merged: 48baa7d
Type: AFK

> Shipped in 48baa7d: `shouldEmitOrbPreview` throttles the re-extraction in
> `useVideoProcessor`, XrayStage cross-fades the refreshes, and the cadence is
> covered by `__tests__/hooks/useVideoProcessor.test.ts`.

## Parent

- `.scratch/done/scan-moving-video-displays/PRD.md`

## What to build

Make the ORB wall-feature "starfield" on the loading `XrayStage` refresh as the scan
progresses, so the dots scroll with the wall and stay coherent with the live pose
skeleton as the camera moves. Today the field is extracted once from the first pose
frame and frozen for the whole run.

- `hooks/useVideoProcessor.ts` — replace the one-time emit (the `orbPreviewSent` guard
  near line 676) with a throttled re-emit. Reuse the frame `ImageData` already captured
  on the periodic cadence (`ctx.getImageData` at line 666, gated by
  `POSE_REANALYSIS_INTERVAL`) plus the current `chosen.keypoints` for climber masking,
  and call the existing `extractWallFeaturePoints(cv, currentFrameData, chosen.keypoints,
currentAnalysis, cropOptions, wallCropPx, …)` → `setOrbPreview(...)`. Throttle to a
  display cadence (~1–2 Hz of processed time), not every detection frame.
- Perf reuse: in Panning Capture the wall-crop ORB is already extracted per Keyframe in
  `captureKeyframe`; feed those points to the starfield instead of a second extraction
  where available.
- `components/skeleton/XrayStage.tsx` — the starfield effect (lines 169–178) already
  rebuilds idempotently on every `orbPreview` change, so it functionally works once emits
  repeat. Add a short cross-fade so dot updates do not pop, and correct the stale
  header/comment that says the starfield is "drawn once and persisting for the whole run."

## Reuse

- `extractWallFeaturePoints` (`hooks/useVideoProcessor.ts:125`) — display-only, masks the
  climber, returns normalised points.
- `setOrbPreview` / `orbPreview` channel; `XrayStage` starfield layer.

## Acceptance criteria

- [x] The loading-screen ORB dots update during the scan and scroll with the wall as the
      camera moves (not frozen at frame-0 positions).
- [x] The live skeleton and the wall dots stay visually coherent as the camera moves.
- [x] Re-extraction is throttled to a bounded display cadence and reuses already-captured
      frame data / Panning keyframe ORB; no measurable slowdown to scan completion.
- [x] Fixed/tripod videos still show a coherent (effectively static) starfield — no
      regression.
- [x] `XrayStage` / `useVideoProcessor` tests cover the re-emit; ORB is mocked at the
      module boundary.

## Blocked by

None - can start immediately
