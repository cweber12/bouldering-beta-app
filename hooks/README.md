# hooks/

React hooks that wire `pipeline/` modules to component state. No OpenCV or TF.js calls directly — hooks call pipeline functions and own all React state transitions and error boundaries.

## Hooks

### `useOpenCV`

Loads `public/opencv.js` (WASM bundle) into the main thread.

```ts
const { ready, cv } = useOpenCV();
```

- `ready: boolean` — true once `onRuntimeInitialized` fires.
- `cv` — the OpenCV.js module (typed as `any`); `null` until ready.

OpenCV **must not** be loaded inside a Web Worker — the WASM bootstrap is async and unreliable in worker scope.

### `useTFModel`

Loads the MoveNet Lightning pose detection model via TF.js.

```ts
const { ready, model } = useTFModel();
```

- `ready: boolean` — true once the model is warm (first inference run).
- `model` — the MoveNet detector instance (typed as `any`); `null` until ready.

### `useVideoProcessor`

Seek loop that samples a video every `intervalMs` milliseconds, runs pose estimation on each frame, then invokes ORB extraction on the first frame.

```ts
const { process, status, orbStatus, currentFrame, totalFrames, attemptId, errorMessage } =
  useVideoProcessor(intervalMs);

process(file, model, cv, mode?, frameStep?);
```

| Field | Type | Description |
|---|---|---|
| `status` | `"idle" \| "processing" \| "done" \| "error"` | Overall pipeline status. |
| `orbStatus` | `"idle" \| "extracting" \| "ready" \| "failed"` | ORB extraction status (set after `status` reaches `"done"`). |
| `currentFrame` | `number` | Frame index currently being processed (for progress UI). |
| `totalFrames` | `number` | Total frames to process. |
| `attemptId` | `string \| null` | ID of the stored `RouteAttempt` once done. |
| `errorMessage` | `string \| null` | Human-readable error when `status === "error"`. |

`mode` defaults to `"indoor"`; `frameStep` (outdoor only) defaults to `5`.

### `useImageMatcher`

Extracts ORB features from an uploaded route photo and matches them against the stored reference.

```ts
const { matchImage, status, result, errorMessage } = useImageMatcher();

await matchImage(file, attemptId, cv);
```

`result` is `ImageMatchResult | null` with fields: `matches`, `queryKeypoints`, `referenceKeypoints`, `queryOrb`.

### `usePoseVideo`

Automatically renders an annotated pose-skeleton WebM video whenever `matchResult` becomes non-null.

```ts
const { videoUrl, status, errorMessage, clearVideo } =
  usePoseVideo(cv, imageFile, attemptId, matchResult);
```

`videoUrl` is a `blob:` object URL for a `<video>` element. Revoke it by calling `clearVideo()` or the hook cleans up on unmount.
