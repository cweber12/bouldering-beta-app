/**
 * ORB feature detection Web Worker.
 *
 * Loads OpenCV.js via importScripts() — the only script-loading API available
 * inside a Worker — then handles detectAndCompute requests from the main thread.
 *
 * Protocol
 * --------
 * detectAndCompute
 *   Main → Worker: { type: 'detectAndCompute', id: string, imageData: ImageData }
 *   Worker → Main: { type: 'result', id, keypoints: OrbKeypoint[], descriptors: Uint8Array }
 *                   descriptors transferred zero-copy via transfer list.
 *
 * match
 *   Main → Worker: { type: 'match', id: string,
 *                    refDescriptors: Uint8Array, refRows: number,
 *                    frameDescriptors: Uint8Array, frameRows: number }
 *   Worker → Main: { type: 'matchResult', id, matches: OrbMatch[] }
 *                   OrbMatch = { queryIdx, trainIdx, distance }
 *                   Uses BFMatcher(NORM_HAMMING) + Lowe ratio test (k=2, ratio=0.75).
 *
 * error (any handler)
 *   Worker → Main: { type: 'error', id: string, message: string }
 *
 * ready
 *   Worker → Main: { type: 'ready' }
 */

// Set up the Emscripten Module callback BEFORE importScripts so we don't miss
// the onRuntimeInitialized event if the runtime initialises synchronously.
// eslint-disable-next-line no-undef
self.Module = {
  onRuntimeInitialized() {
    // eslint-disable-next-line no-undef
    self.postMessage({ type: "ready" });
  },
};

// Load OpenCV.js from /public/opencv.js (served at the origin root).
// importScripts resolves against the origin, so '/opencv.js' is always correct.
// eslint-disable-next-line no-undef
importScripts("/opencv.js");

// eslint-disable-next-line no-undef
self.onmessage = function (event) {
  const { type, id } = event.data;

  if (type === "detectAndCompute") {
    handleDetectAndCompute(event.data);
  } else if (type === "match") {
    handleMatch(event.data);
  }
};

function handleDetectAndCompute(data) {
  const { imageData, id } = data;

  // Declare all OpenCV objects outside the try so the finally block can clean
  // up anything that was successfully allocated, even after a partial failure.
  let src = null;
  let gray = null;
  let mask = null;
  let keypoints = null;
  let descriptors = null;
  let orb = null;

  try {
    // eslint-disable-next-line no-undef
    const cv = self.cv;

    // Build a Mat from the transferred ImageData (RGBA, 4 channels).
    src = cv.matFromImageData(imageData);

    // ORB requires a single-channel (grayscale) input.
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    keypoints = new cv.KeyPointVector();
    descriptors = new cv.Mat();
    mask = new cv.Mat(); // empty Mat = no spatial mask
    orb = new cv.ORB(500); // 500 features matches OpenCV default

    orb.detectAndCompute(gray, mask, keypoints, descriptors);

    // Serialize keypoints to plain JS objects so they cross the message
    // boundary without any WASM heap pointers.
    const kpArray = [];
    for (let i = 0; i < keypoints.size(); i++) {
      const kp = keypoints.get(i);
      kpArray.push({
        pt: { x: kp.pt.x, y: kp.pt.y },
        size: kp.size,
        angle: kp.angle,
        response: kp.response,
        octave: kp.octave,
      });
    }

    // Copy descriptor bytes out of WASM memory BEFORE deleting the Mat.
    // new Uint8Array(typedArray) copies values — it does NOT share the buffer.
    const descCopy = new Uint8Array(descriptors.data);

    // Transfer descCopy.buffer so the main thread receives it with zero copy.
    // eslint-disable-next-line no-undef
    self.postMessage(
      { type: "result", id, keypoints: kpArray, descriptors: descCopy },
      [descCopy.buffer],
    );
  } catch (err) {
    // eslint-disable-next-line no-undef
    self.postMessage({ type: "error", id, message: err?.message ?? String(err) });
  } finally {
    // Always free WASM heap allocations to prevent leaks.
    orb?.delete();
    descriptors?.delete();
    keypoints?.delete();
    mask?.delete();
    gray?.delete();
    src?.delete();
  }
}

/**
 * Match two sets of ORB descriptors using BFMatcher + Lowe ratio test.
 * Descriptor bytes are reconstructed into Mats from the flat Uint8Arrays.
 * Descriptors are NOT transferred from main thread — the reference set must
 * survive multiple match calls.
 */
function handleMatch(data) {
  const { id, refDescriptors, refRows, frameDescriptors, frameRows } = data;

  // eslint-disable-next-line no-undef
  const cv = self.cv;
  const COLS = 32; // ORB: 256-bit = 32-byte descriptor rows

  // knnMatch(k=2) requires at least 2 rows in the query set.
  if (!refRows || frameRows < 2) {
    // eslint-disable-next-line no-undef
    self.postMessage({ type: "matchResult", id, matches: [] });
    return;
  }

  let desc1 = null;
  let desc2 = null;
  let bf = null;
  let knnMatches = null;

  try {
    desc1 = new cv.Mat(refRows, COLS, cv.CV_8UC1);
    desc1.data.set(refDescriptors.subarray(0, refRows * COLS));

    desc2 = new cv.Mat(frameRows, COLS, cv.CV_8UC1);
    desc2.data.set(frameDescriptors.subarray(0, frameRows * COLS));

    bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
    knnMatches = new cv.DMatchVectorVector();
    bf.knnMatch(desc1, desc2, knnMatches, 2);

    const RATIO = 0.75;
    const matches = [];
    for (let i = 0; i < knnMatches.size(); i++) {
      const pair = knnMatches.get(i);
      if (pair.size() >= 2) {
        const m = pair.get(0);
        const n = pair.get(1);
        if (m.distance < RATIO * n.distance) {
          matches.push({
            queryIdx: m.queryIdx,
            trainIdx: m.trainIdx,
            distance: m.distance,
          });
        }
      }
    }

    // eslint-disable-next-line no-undef
    self.postMessage({ type: "matchResult", id, matches });
  } catch (err) {
    // eslint-disable-next-line no-undef
    self.postMessage({ type: "error", id, message: err?.message ?? String(err) });
  } finally {
    knnMatches?.delete();
    bf?.delete();
    desc2?.delete();
    desc1?.delete();
  }
}
