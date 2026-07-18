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

  // Recalibrated bundle: the truth still stamps the previous calibration's
  // hash (stale), one run pairs with the truth, one was scanned under the new
  // calibration and pairs with nothing (the harness's setupHash-mismatch skip).
  const d = path.join(root, "route-d", "vid_3");
  await mkdir(path.join(d, "detections"), { recursive: true });
  await writeFile(path.join(d, "metadata.json"), JSON.stringify({ source_title: "Clip D" }));
  await writeFile(path.join(d, "setup.json"), JSON.stringify({ version: 1, setupHash: "new-hash" }));
  await writeFile(
    path.join(d, "ground-truth.json"),
    JSON.stringify({ setupHash: "old-hash", frames: [] }),
  );
  await writeFile(
    path.join(d, "detections", "20260101_000000_pose.json"),
    JSON.stringify({ setupHash: "old-hash" }),
  );
  await writeFile(
    path.join(d, "detections", "20260102_000000_pose.json"),
    JSON.stringify({ setupHash: "new-hash" }),
  );

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
    expect(items.map((i) => i.key)).toEqual([
      "route-b/vid_2",
      "route-a/vid_1",
      "route-d/vid_3",
    ]);

    const a = items.find((i) => i.key === "route-a/vid_1")!;
    expect(a.hasSetup).toBe(true);
    expect(a.hasGroundTruth).toBe(true);
    expect(a.runCount).toBe(2);
    expect(a.title).toBe("Clip A");
    expect(a.videoPath).toBe("analysis/route-a/vid_1/vid_1.mp4");
    expect(a.analysisInputs).toEqual({ shadows: "low" });
    // Hashless legacy bundle: never read as stale or unpaired.
    expect(a.truthStale).toBe(false);
    expect(a.unpairedRunCount).toBe(0);

    const b = items.find((i) => i.key === "route-b/vid_2")!;
    expect(b.hasSetup).toBe(false);
    expect(b.hasGroundTruth).toBe(false);
    expect(b.runCount).toBe(0);
    expect(b.truthStale).toBe(false);
    expect(b.unpairedRunCount).toBe(0);
    expect(b.analysisInputs).toBeNull();
  });

  it("marks truth stale and counts unpaired runs from the setupHash chain", async () => {
    const items = await listCorpus();
    const d = items.find((i) => i.key === "route-d/vid_3")!;

    // Truth stamps old-hash, setup.json stamps new-hash → stale evidence.
    expect(d.hasGroundTruth).toBe(true);
    expect(d.truthStale).toBe(true);

    // The old-hash run pairs with the truth; the new-hash run pairs with
    // nothing — exactly the harness's setupHash-mismatch skip.
    expect(d.runCount).toBe(2);
    expect(d.unpairedRunCount).toBe(1);
  });
});
