# Play the Real Video Behind the Detection Preview

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/moving-video-displays/PRD.md`

## What to build

Draw the actual source video underneath the per-frame skeleton in the Detection Preview,
replacing the frozen first video frame, so the overlay always sits on real footage as the
climb progresses. Applies to both the user flow and the dev harness.

- `components/skeleton/FramePlayer.tsx` — add an optional video-background source (e.g.
  `videoSrc?: string` / `videoFile?: File`). When present: draw video frames via
  `ctx.drawImage(video, …)` driven by `requestVideoFrameCallback` for frame-accurate
  sync, size the canvas to the video's natural dimensions, and drive/sync playback `t`
  from the video's `currentTime` so `findNearest(layer.frames, t)` stays aligned. Leave
  the existing static-image path (`imageFile` → `createImageBitmap`) untouched for Route
  Overlay and Compare. Skeleton frames are already in video-pixel space
  (`app/scan/page.tsx:392` builds `kp.x * videoMeta.width`), so they map 1:1; the ORB-dots
  and Holds passes keep working.
- `components/scan/process-flow/StepViewLandmarks.tsx` — pass the source video into the
  Detection-Preview `FramePlayer` (new prop). Keep `firstFrameFile` as the pre-ready /
  poster fallback.
- `app/scan/page.tsx` — thread the retained `videoPreviewUrl` (line 176) / `pendingFile`
  down to `StepViewLandmarks` as the new prop.
- `app/dev/harness/page.tsx` — pass the retained `videoUrl` / `videoFile` (lines 248–249)
  into its Calibrator preview `FramePlayer` (lines 589–591).

Follow the CLAUDE.md media rule: size the container to the media (`object-fill`, no
`object-contain` letterboxing) so overlay coordinates map correctly. Watch resource
hygiene: revoke any created object URLs and release the video on unmount, mirroring the
existing bitmap cleanup.

## Acceptance criteria

- [ ] The Detection Preview plays the real source video with the per-frame skeleton
      overlaid; the skeleton stays on the climber through the whole climb, not on a stale
      first frame.
- [ ] Play / pause / seek work against the video timeline.
- [ ] ORB dots (Developer view) and Holds still render correctly over the video.
- [ ] The static-image `FramePlayer` path (Route Overlay, Compare) is unchanged.
- [ ] The dev harness Calibrator preview plays the corpus video with the overlay.
- [ ] `FramePlayer` tests cover the video-background path and confirm the static path is
      unaffected.

## Blocked by

None - can start immediately (independent of issue 01)
