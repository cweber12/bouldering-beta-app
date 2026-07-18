import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listCorpus } from "@/app/api/dev/shared";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "harness-corpus-"));

  // Calibrated bundle with two detection runs.
  const a = path.join(root, "route-a", "vid_1");
  await mkdir(path.join(a, "detections"), { recursive: true });
  await writeFile(
    path.join(a, "metadata.json"),
    JSON.stringify({ source_title: "Clip A", analysis_inputs: { shadows: "low" } }),
  );
  await writeFile(path.join(a, "setup.json"), JSON.stringify({ version: 1 }));
  await writeFile(path.join(a, "ground-truth.json"), JSON.stringify({ frames: [] }));
  await writeFile(path.join(a, "detections", "20260101_000000_pose.json"), "{}");
  await writeFile(path.join(a, "detections", "20260101_000000_orb.json"), "{}");
  await writeFile(path.join(a, "detections", "20260102_000000_pose.json"), "{}");
  await writeFile(path.join(a, "detections", "20260102_000000_orb.json"), "{}");

  // Pending bundle: metadata but no setup and no runs.
  const b = path.join(root, "route-b", "vid_2");
  await mkdir(b, { recursive: true });
  await writeFile(path.join(b, "metadata.json"), JSON.stringify({ source_title: "Clip B" }));

  // Not a bundle (no metadata.json) — must be skipped.
  await mkdir(path.join(root, "route-c", "no_meta"), { recursive: true });

  process.env.HARNESS_ANALYSIS_ROOT = root;
});

afterAll(async () => {
  delete process.env.HARNESS_ANALYSIS_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe("listCorpus", () => {
  it("surfaces bundles with setup/run flags, pending first, skipping non-bundles", async () => {
    const items = await listCorpus();

    // Pending (un-calibrated) sorts before calibrated; non-bundle dir is gone.
    expect(items.map((i) => i.key)).toEqual(["route-b/vid_2", "route-a/vid_1"]);

    const a = items.find((i) => i.key === "route-a/vid_1")!;
    expect(a.hasSetup).toBe(true);
    expect(a.hasGroundTruth).toBe(true);
    expect(a.runCount).toBe(2);
    expect(a.title).toBe("Clip A");
    expect(a.videoPath).toBe("analysis/route-a/vid_1/vid_1.mp4");
    expect(a.analysisInputs).toEqual({ shadows: "low" });

    const b = items.find((i) => i.key === "route-b/vid_2")!;
    expect(b.hasSetup).toBe(false);
    expect(b.hasGroundTruth).toBe(false);
    expect(b.runCount).toBe(0);
    expect(b.analysisInputs).toBeNull();
  });
});
