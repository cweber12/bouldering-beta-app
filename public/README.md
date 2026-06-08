# /public assets

## Generated binary assets

The following files are intentionally not committed and must be generated or downloaded locally:

- `public/opencv.js`
- `public/models/pose/pose_landmarker_lite.task`
- `public/models/pose/pose_landmarker_full.task`
- `public/models/pose/pose_landmarker_heavy.task`

### How to set it up (one-time, after cloning)

```powershell
npm install          # installs @techstark/opencv-js and all other deps
npm run setup:assets # copies opencv.js and downloads MediaPipe pose models
```

You can also run setup scripts independently:

```powershell
npm run setup:opencv
npm run setup:pose-models
```

### Why this approach?

OpenCV.js uses an Emscripten WASM runtime that cannot be bundled through Next.js/webpack. It must be loaded via a plain `<script>` tag at runtime. Placing the file here serves it at `/opencv.js` as a static asset.

The `@techstark/opencv-js` npm package provides the official prebuilt binary, and MediaPipe models are downloaded from official model storage. Versions and paths are controlled by scripts in `scripts/`.

These binary files are listed in `.gitignore` — do not force-commit them.

### Upgrading OpenCV.js / MediaPipe models

1. Update the relevant versions and/or source URLs in scripts and hooks.
2. Delete old generated assets under `public/`.
3. Run `npm install ; npm run setup:assets`.
