/**
 * scripts/fetch-mediapipe-wasm.mjs
 *
 * Copies MediaPipe Tasks Vision WASM runtime files from node_modules into
 * /public/mediapipe/wasm so the browser loads them from same-origin assets.
 *
 * Run via: npm run setup:mediapipe-wasm
 */

import { access, copyFile, mkdir, readdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_DIR = resolve(ROOT, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const DEST_DIR = resolve(ROOT, "public", "mediapipe", "wasm");

const force = process.argv.includes("--force");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(SRC_DIR))) {
    console.error(
      "[setup:mediapipe-wasm] Could not find @mediapipe/tasks-vision wasm files in node_modules.\n" +
        "  Run: npm install\n" +
        "  Then re-run: npm run setup:mediapipe-wasm",
    );
    process.exit(1);
  }

  await mkdir(DEST_DIR, { recursive: true });

  const entries = await readdir(SRC_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && (e.name.endsWith(".js") || e.name.endsWith(".wasm")))
    .map((e) => e.name);

  for (const file of files) {
    const src = resolve(SRC_DIR, file);
    const dest = resolve(DEST_DIR, file);

    if (!force && (await exists(dest))) {
      continue;
    }

    await copyFile(src, dest);
    console.log(`[setup:mediapipe-wasm] Copied ${file}`);
  }

  console.log(
    "[setup:mediapipe-wasm] MediaPipe WASM runtime files are ready in public/mediapipe/wasm",
  );
}

main().catch((err) => {
  console.error("[setup:mediapipe-wasm] Error:", err.message);
  process.exit(1);
});
