# storage/

## `sessionStore.ts`

In-memory `Map`-backed store for the current browser session. No persistence — data lives until the page is hard-reloaded or the tab is closed. A future IndexedDB layer will be drop-in replaceable by only touching this file.

### Types

| Type | Description |
|---|---|
| `RouteAttempt` | A processed climbing attempt: ID, video metadata, pose frames, ORB features, per-frame match results, frame captures. |
| `VideoMeta` | Source video filename, duration, FPS, width, height. |
| `FrameCapture` | Per-frame metadata for outdoor mode: index, timestamp, crop box applied. |

Re-exports `OrbKeypoint`, `OrbFeatures`, `OrbMatch` from `pipeline/orbDetector` and `CropBox` from `pipeline/cropDetector` — consumers import types from here rather than directly from `pipeline/`.

### Functions

| Function | Signature | Description |
|---|---|---|
| `saveAttempt` | `(attempt: RouteAttempt) → void` | Insert or overwrite an attempt by ID. |
| `getAttempt` | `(id: string) → RouteAttempt \| undefined` | Retrieve by ID. |
| `listAttemptIds` | `() → string[]` | All stored IDs. |
| `deleteAttempt` | `(id: string) → void` | Remove by ID (no-op if absent). |
| `clearStore` | `() → void` | Remove all entries (used in tests). |

### Serialization note

`OrbFeatures.descriptors` is a `Uint8Array`. When saving an attempt to a JSON file for download, callers must convert it to a plain `number[]` via `Array.from(descriptors)` before calling `JSON.stringify`. When loading back from JSON, convert the `number[]` back to `new Uint8Array(arr)`.
