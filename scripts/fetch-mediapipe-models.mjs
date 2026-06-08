/**
 * scripts/fetch-mediapipe-models.mjs
 *
 * Downloads MediaPipe Pose Landmarker .task model files into
 * /public/models/pose so the app can load them from same-origin static paths.
 *
 * Run via: npm run setup:pose-models
 */

import { access, mkdir, writeFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEST_DIR = resolve(ROOT, "public", "models", "pose");

const MODELS = [
  {
    variant: "lite",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
    file: "pose_landmarker_lite.task",
  },
  {
    variant: "full",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
    file: "pose_landmarker_full.task",
  },
  {
    variant: "heavy",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task",
    file: "pose_landmarker_heavy.task",
  },
];

const force = process.argv.includes("--force");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadTo(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(filePath, bytes);
}

async function main() {
  await mkdir(DEST_DIR, { recursive: true });

  for (const model of MODELS) {
    const dest = resolve(DEST_DIR, model.file);
    const alreadyExists = await exists(dest);

    if (alreadyExists && !force) {
      console.log(`[setup:pose-models] ${model.file} already exists - skipping.`);
      continue;
    }

    console.log(`[setup:pose-models] Downloading ${model.variant} -> ${model.file}`);
    await downloadTo(model.url, dest);
  }

  console.log("[setup:pose-models] Pose model files are ready in public/models/pose");
}

main().catch((err) => {
  console.error("[setup:pose-models] Error:", err.message);
  process.exit(1);
});
