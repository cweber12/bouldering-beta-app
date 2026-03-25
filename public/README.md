# /public assets

## opencv.js

`opencv.js` is **not committed** to this repository — it is large (~8 MB) and must be downloaded separately.

### How to obtain it

Download the pre-built WASM/JS build from the official OpenCV.js releases:

```
https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html
```

Place `opencv.js` in this directory so it is served at `/opencv.js`.
The app loads it at runtime via a `<script>` tag (not bundled through Next.js/webpack).

`opencv.js` is listed in `.gitignore` — do not force-commit it.
