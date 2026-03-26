/**
 * scripts/fetch-opencv.mjs
 *
 * Copies the prebuilt opencv.js from the @techstark/opencv-js npm package into
 * /public/opencv.js so it can be served as a static asset at /opencv.js.
 *
 * Run via: npm run setup:opencv
 *
 * Why copy instead of import?
 *   OpenCV.js uses Emscripten's WASM runtime initialisation, which does NOT
 *   work when bundled through webpack/Next.js. It must be loaded via a plain
 *   <script> tag at runtime. Placing it in /public achieves this.
 *
 * The file is intentionally excluded from git (see .gitignore).
 * Every developer and CI job should run this script once after cloning,
 * or after bumping the @techstark/opencv-js version in package.json.
 */

import { copyFile, mkdir, access } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "node_modules", "@techstark", "opencv-js", "dist", "opencv.js");
const DEST = resolve(ROOT, "public", "opencv.js");

async function main() {
  // Check the source exists — means npm install has been run.
  try {
    await access(SRC);
  } catch {
    console.error(
      "[setup:opencv] Could not find @techstark/opencv-js in node_modules.\n" +
        "  Run: npm install\n" +
        "  Then re-run: npm run setup:opencv",
    );
    process.exit(1);
  }

  // Skip if already present.
  try {
    await access(DEST);
    console.log("[setup:opencv] public/opencv.js already exists — skipping copy.");
    console.log("  To refresh, delete public/opencv.js and re-run this script.");
    process.exit(0);
  } catch {
    // File doesn't exist yet — proceed.
  }

  await mkdir(resolve(ROOT, "public"), { recursive: true });
  await copyFile(SRC, DEST);

  console.log("[setup:opencv] Copied opencv.js to public/opencv.js");
}

main().catch((err) => {
  console.error("[setup:opencv] Error:", err.message);
  process.exit(1);
});

