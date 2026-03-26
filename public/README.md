# /public assets

## opencv.js

`opencv.js` is **not committed** to this repository — it is large (~10 MB) and must be generated locally from the npm package.

### How to set it up (one-time, after cloning)

```powershell
npm install          # installs @techstark/opencv-js and all other deps
npm run setup:opencv # copies opencv.js from node_modules into this folder
```

### Why this approach?

OpenCV.js uses an Emscripten WASM runtime that cannot be bundled through Next.js/webpack. It must be loaded via a plain `<script>` tag at runtime. Placing the file here serves it at `/opencv.js` as a static asset.

The `@techstark/opencv-js` npm package provides the official prebuilt binary. The version is pinned in `package.json`, which keeps everyone on the same build without committing a large binary to git.

`opencv.js` is listed in `.gitignore` — do not force-commit it.

### Upgrading OpenCV.js

1. Update `@techstark/opencv-js` in `package.json`.
2. Delete `public/opencv.js`.
3. Run `npm install ; npm run setup:opencv`.
