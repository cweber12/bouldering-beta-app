# Component Rules

Scoped instructions for `components/` work. General rules live in the root `CLAUDE.md` / `AGENTS.md` and still apply.

## Scan page flow (app/scan/)

The scan page is a multi-step wizard. Each step is a component under `components/scan/process-flow/`:

1. **StepPickVideo** — user selects or records a video (camera modal). The video is stored only in React state; nothing hits S3 yet.
2. **StepSetDetection** — user draws a crop box over the climber. `CropBoxOverlay` writes fractional coordinates; `useVideoProcessor` drives the seek loop that feeds frames to `mediapipePoseDetection.ts → estimateFramesMediaPipe()`.
3. **StepViewLandmarks** — shows the sparse pose frames, lets the user trim/review. `useSkeletonFrames` pre-computes `SkeletonFrameData` from those frames.
4. **StepMatchRoutePhoto** — user uploads a route photo. `useImageMatcher` calls `extractFeatures` (ORB on the first video frame) then `matchFeatures`, then `computeHomography` to find the perspective transform from video-space to photo-space.
5. **Save flow** — `usePoseVideo` auto-renders an annotated WebM using `poseVideoRenderer.ts` (MediaRecorder + canvas.captureStream). `MetadataBottomSheet` collects route name / location / run type. `useS3Storage.uploadAttempt` serialises via `fsHelpers.ts` and POSTs to `/api/s3/put`.

## Compare page flow (app/compare/)

Two `CompareSlot` components each independently run the scan pipeline. `CompareOverlayPlayer` time-syncs both skeleton overlays using `multiPoseVideoRenderer.ts`.

## Media previews with crop overlays

- **Never** display media with `object-contain` CSS when a `CropBoxOverlay` is involved — letterboxing causes crop fractions to map to the container rather than the actual media bounds.
- Use an aspect-ratio-constrained container with `object-fill` class on the media element so the container IS the media bounds. Crop fractions then map 1:1 to media pixels.
- CSS variable `--nav-h: 3rem` (NavBar height) is defined in `app/globals.css` `:root`.
- **Viewport-fit pattern** (inline preview):
  ```tsx
  function mediaContainerStyle(w: number, h: number): React.CSSProperties {
    const ratio = (w / h).toFixed(6);
    const maxH = "calc(100dvh - var(--nav-h) - 1rem)";
    return {
      width: `min(100%, calc(${maxH} * ${ratio}))`,
      maxHeight: maxH,
      aspectRatio: `${w} / ${h}`,
    };
  }
  // Media element: className="absolute inset-0 w-full h-full object-fill"
  ```
- **Fullscreen pattern**: `fsMediaContainerStyle` uses `maxHeight: calc(100dvh - 8rem)`.
- **Height-filling pattern** (scan flow Steps 2 & 3): fills the available vertical space `s` with the media, width following the aspect ratio and capped to `100%`. Both orientations reach the full height (landscape caps to viewport width only on narrow screens), so the media stays flush against the footer rather than leaving a vertical gap. Helpers in `utils/mediaContainerStyle.ts`: `fitMediaStyle(w, h, s)` / `fitMediaWidth(w, h, s)` take a **measured** `s` (px, via `useMeasuredHeight` on a `flex-1 min-h-0` stage); `fitMediaMaxWidth(w, h, offset)` is the dvh-calc variant for flow layouts. The scan video stage is flush (no border/radius/padding) and centered on `bg-surface`; the transport bar aligns to `fitMediaWidth`. Default the pre-load aspect ratio to portrait `{ w: 9, h: 16 }` (ascents are recorded vertically).
- Detect natural size: `onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}` for images; `setSize({ w: video.videoWidth || 16, h: video.videoHeight || 9 })` in the `onLoadedData`/`canplay` handler for videos. Default to `{ w: 4, h: 3 }` or `{ w: 16, h: 9 }` before load.
- Every media container with a crop overlay must have an **Expand** button that opens a fullscreen portal: `createPortal(<div className="fixed inset-0 z-fullscreen flex flex-col bg-surface" role="dialog" aria-modal="true">…</div>, document.body)`.
- Add an ESC key `useEffect` that closes the fullscreen when `useEffect([…], [fsState])` is active.
- **Video previews**: show crop-mode buttons (Climber / Wall texture) in a `<div className="flex items-center gap-2 flex-wrap">` toolbar **above** the video container.
- **Image previews**: no crop-mode toolbar — only the single `CropBoxOverlay` crop box is shown.
- Fullscreen video uses a separate `useRef<HTMLVideoElement>` so it plays independently; sync `currentTime` on open and back to the inline player on close.
