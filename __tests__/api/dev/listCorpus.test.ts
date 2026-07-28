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
  // Runs land in the downloader's envelope (`data` holds the scanner payload);
  // the bare shape is accepted too.
  await writeFile(
    path.join(d, "detections", "20260101_000000_pose.json"),
    JSON.stringify({
      video_key: "vid_3",
      route_folder: "route-d",
      type: "pose",
      data: { setupHash: "old-hash" },
    }),
  );
  await writeFile(
    path.join(d, "detections", "20260102_000000_pose.json"),
    JSON.stringify({ setupHash: "new-hash" }),
  );

  // Stale-truth bundles in the three scaffold states the seed-ready flag
  // distinguishes (route-d above is the fourth: missing scaffold).
  const posedScaffold = (setupHash: string) =>
    JSON.stringify({
      version: 1,
      setupHash,
      frames: [
        { timestamp: 0, keypoints: [] },
        { timestamp: 0.1, keypoints: [{ name: "nose", x: 0.5, y: 0.5, score: 0.9 }] },
      ],
    });
  const staleTruthBundle = async (routeFolder: string, videoKey: string, vitpose: string) => {
    const dir = path.join(root, routeFolder, videoKey);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "metadata.json"), JSON.stringify({}));
    await writeFile(path.join(dir, "setup.json"), JSON.stringify({ setupHash: "new-hash" }));
    await writeFile(path.join(dir, "ground-truth.json"), JSON.stringify({ setupHash: "old-hash" }));
    await writeFile(path.join(dir, "vitpose.json"), vitpose);
  };
  // Seed-ready: scaffold stamps the current hash and poses a frame.
  await staleTruthBundle("route-e", "vid_4", posedScaffold("new-hash"));
  // Fresh but poseless: the tracker found no Climber — never seed-ready.
  await staleTruthBundle(
    "route-f",
    "vid_5",
    JSON.stringify({ version: 1, setupHash: "new-hash", frames: [{ timestamp: 0, keypoints: [] }] }),
  );
  // Stale scaffold: stamped under the previous calibration.
  await staleTruthBundle("route-g", "vid_6", posedScaffold("old-hash"));

  // Truthless + set up, with a current-calibration poseless scaffold: the last
  // ViTPose job tracked no Climber with this seed → Untrackable, held out of the
  // Batch Calibrate sweep until re-seeded.
  const h = path.join(root, "route-h", "vid_7");
  await mkdir(h, { recursive: true });
  await writeFile(path.join(h, "metadata.json"), JSON.stringify({}));
  await writeFile(path.join(h, "setup.json"), JSON.stringify({ setupHash: "new-hash" }));
  await writeFile(
    path.join(h, "vitpose.json"),
    JSON.stringify({ version: 1, setupHash: "new-hash", frames: [{ timestamp: 0, keypoints: [] }] }),
  );

  // Fresh (non-stale) accepted truth AND a current poseless scaffold: a later
  // re-seed posed nothing, but the good truth still stands, so the bundle is
  // never Untrackable — the fresh-truth immunity scoping.
  const i = path.join(root, "route-i", "vid_8");
  await mkdir(i, { recursive: true });
  await writeFile(path.join(i, "metadata.json"), JSON.stringify({}));
  await writeFile(path.join(i, "setup.json"), JSON.stringify({ setupHash: "new-hash" }));
  await writeFile(path.join(i, "ground-truth.json"), JSON.stringify({ setupHash: "new-hash" }));
  await writeFile(
    path.join(i, "vitpose.json"),
    JSON.stringify({ version: 1, setupHash: "new-hash", frames: [{ timestamp: 0, keypoints: [] }] }),
  );

  // Scaffold-drift bundles (harness ADR 0007 / issue #119). The calibration
  // matches on every one of them — a re-seed does not touch `setupHash` — so
  // only the scaffold's `seedHash` can tell these apart.
  const driftBundle = async (
    videoKey: string,
    truthSeedHash: string | undefined,
    scaffoldSeedHash: string | undefined,
  ) => {
    const dir = path.join(root, "route-j", videoKey);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "metadata.json"), JSON.stringify({}));
    await writeFile(path.join(dir, "setup.json"), JSON.stringify({ setupHash: "new-hash" }));
    await writeFile(
      path.join(dir, "ground-truth.json"),
      JSON.stringify({ setupHash: "new-hash", scaffoldSeedHash: truthSeedHash }),
    );
    await writeFile(
      path.join(dir, "vitpose.json"),
      JSON.stringify({
        version: 1,
        setupHash: "new-hash",
        seedHash: scaffoldSeedHash,
        frames: [{ timestamp: 0.1, keypoints: [{ name: "nose", x: 0.5, y: 0.5, score: 0.9 }] }],
      }),
    );
  };
  // Adrift: truth describes a scaffold that has since been re-seeded.
  await driftBundle("vid_drift", "seed-old", "seed-new");
  // Same scaffold — the healthy case.
  await driftBundle("vid_same", "seed-one", "seed-one");
  // Unstamped truth (written before this contract) against a stamped scaffold.
  await driftBundle("vid_notruthstamp", undefined, "seed-new");
  // Stamped truth against a pre-ADR 0007 scaffold that carries no seed hash.
  await driftBundle("vid_noscaffoldstamp", "seed-old", undefined);

  // Drift-heuristic bundles: truth carries no scaffold stamp, so only the
  // present-vs-posed shortfall can suggest the scaffold moved underneath it.
  // Frame counts are the real `get-carter/fKjfXtqLA1I` shape, scaled down.
  const heuristicBundle = async (
    videoKey: string,
    presentFrames: number,
    posedFrames: number,
    stamps: { truthSeedHash?: string; scaffoldSeedHash?: string } = {},
  ) => {
    const dir = path.join(root, "route-k", videoKey);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "metadata.json"), JSON.stringify({}));
    await writeFile(path.join(dir, "setup.json"), JSON.stringify({ setupHash: "new-hash" }));
    await writeFile(
      path.join(dir, "ground-truth.json"),
      JSON.stringify({
        setupHash: "new-hash",
        scaffoldSeedHash: stamps.truthSeedHash,
        frames: Array.from({ length: posedFrames }, (_, i) => ({
          frameIndex: i,
          timestamp: i / 10,
          state: i < presentFrames ? "present" : "absent",
          joints: {},
          review: "auto",
          verified: true,
        })),
      }),
    );
    await writeFile(
      path.join(dir, "vitpose.json"),
      JSON.stringify({
        version: 1,
        setupHash: "new-hash",
        seedHash: stamps.scaffoldSeedHash ?? "seed-new",
        frames: Array.from({ length: posedFrames }, (_, i) => ({
          timestamp: i / 10,
          keypoints: [{ name: "nose", x: 0.5, y: 0.5, score: 0.9 }],
        })),
      }),
    );
  };
  // Adrift: truth holds a fraction of what the scaffold poses.
  await heuristicBundle("vid_shortfall", 19, 181);
  // Ordinary authoring: a handful of frames flagged absent.
  await heuristicBundle("vid_flagged", 178, 181);
  // Same lopsided counts, but the truth is stamped — the exact comparison is
  // available and agrees, so the guess must stay silent.
  await heuristicBundle("vid_stamped", 19, 181, {
    truthSeedHash: "seed-new",
    scaffoldSeedHash: "seed-new",
  });

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
      "route-e/vid_4",
      "route-f/vid_5",
      "route-g/vid_6",
      "route-h/vid_7",
      "route-i/vid_8",
      "route-j/vid_drift",
      "route-j/vid_noscaffoldstamp",
      "route-j/vid_notruthstamp",
      "route-j/vid_same",
      "route-k/vid_flagged",
      "route-k/vid_shortfall",
      "route-k/vid_stamped",
    ]);

    const a = items.find((i) => i.key === "route-a/vid_1")!;
    expect(a.hasSetup).toBe(true);
    expect(a.hasGroundTruth).toBe(true);
    expect(a.runCount).toBe(2);
    expect(a.title).toBe("Clip A");
    expect(a.videoPath).toBe("analysis/route-a/vid_1/vid_1.mp4");
    expect(a.analysisInputs).toEqual({ shadows: "low" });
    // Hashless legacy bundle: never read as stale or unpaired — both runs pair.
    expect(a.truthStale).toBe(false);
    expect(a.pairedRunCount).toBe(2);
    expect(a.unpairedRunCount).toBe(0);

    const b = items.find((i) => i.key === "route-b/vid_2")!;
    expect(b.hasSetup).toBe(false);
    expect(b.hasGroundTruth).toBe(false);
    expect(b.runCount).toBe(0);
    expect(b.truthStale).toBe(false);
    expect(b.pairedRunCount).toBe(0);
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
    expect(d.pairedRunCount).toBe(1);
    expect(d.unpairedRunCount).toBe(1);
  });

  it("marks truth stale when it was authored from a superseded scaffold", async () => {
    const items = await listCorpus();
    const byKey = (k: string) => items.find((i) => i.key === k)!;

    // The calibration matches on all four — re-seeding never moves `setupHash`,
    // which is exactly why the scaffold axis had to be added rather than derived.
    const drift = byKey("route-j/vid_drift");
    expect(drift.hasGroundTruth).toBe(true);
    expect(drift.truthStale).toBe(true);

    expect(byKey("route-j/vid_same").truthStale).toBe(false);
  });

  // Fail-open: a missing stamp on either side is *unknown* provenance, never a
  // failure. Degrading these to stale would have flagged the whole corpus on the
  // day this shipped, which is the opposite of a trustworthy signal.
  it("never marks truth stale when either scaffold stamp is missing", async () => {
    const items = await listCorpus();
    const byKey = (k: string) => items.find((i) => i.key === k)!;

    expect(byKey("route-j/vid_notruthstamp").truthStale).toBe(false);
    expect(byKey("route-j/vid_noscaffoldstamp").truthStale).toBe(false);
  });

  // The fallback for the truth a hash comparison cannot reach — every bundle in
  // the corpus on the day the stamp shipped. Reported separately from
  // `truthStale` because it is a guess, not a proof.
  it("infers drift for unstamped truth holding far fewer present frames than the scaffold poses", async () => {
    const items = await listCorpus();
    const byKey = (k: string) => items.find((i) => i.key === k)!;

    const drifted = byKey("route-k/vid_shortfall");
    expect(drifted.truthDrifted).toBe(true);
    // Kept out of the proven signal — nothing here stamps anything.
    expect(drifted.truthStale).toBe(false);

    // Ordinary flagging must never read as drift.
    expect(byKey("route-k/vid_flagged").truthDrifted).toBe(false);

    // Once the truth is stamped the exact comparison takes over and agrees, so
    // the guess retires for this bundle however lopsided its counts stay.
    expect(byKey("route-k/vid_stamped").truthDrifted).toBe(false);
    expect(byKey("route-k/vid_stamped").truthStale).toBe(false);
  });

  it("never guesses at drift on a bundle already proven stale", async () => {
    const items = await listCorpus();
    const drift = items.find((i) => i.key === "route-j/vid_drift")!;
    expect(drift.truthStale).toBe(true);
    expect(drift.truthDrifted).toBe(false);
  });

  it("flags seed-ready only for a fresh, posed scaffold", async () => {
    const items = await listCorpus();
    const byKey = (k: string) => items.find((i) => i.key === k)!;

    // Fresh scaffold that poses a frame → one click from review.
    expect(byKey("route-e/vid_4").seedReady).toBe(true);
    expect(byKey("route-e/vid_4").truthStale).toBe(true);

    // Fresh but poseless — the tracker found no Climber.
    expect(byKey("route-f/vid_5").seedReady).toBe(false);
    // Scaffold stamped under the previous calibration.
    expect(byKey("route-g/vid_6").seedReady).toBe(false);
    // No vitpose.json at all.
    expect(byKey("route-d/vid_3").seedReady).toBe(false);
  });

  it("flags Untrackable for a current poseless scaffold on a bundle without fresh truth", async () => {
    const items = await listCorpus();
    const byKey = (k: string) => items.find((i) => i.key === k)!;

    // Stale truth + current poseless scaffold → Untrackable (re-seed stale sweep skips it).
    expect(byKey("route-f/vid_5").untrackable).toBe(true);
    // Truthless + current poseless scaffold → Untrackable (Batch Calibrate skips it).
    expect(byKey("route-h/vid_7").untrackable).toBe(true);

    // A stale scaffold is retryable, not Untrackable — the scan inputs changed.
    expect(byKey("route-g/vid_6").untrackable).toBe(false);
    // No scaffold on disk is un-jobbed, not failed.
    expect(byKey("route-d/vid_3").untrackable).toBe(false);
    // A seed-ready (posed) scaffold is not Untrackable.
    expect(byKey("route-e/vid_4").untrackable).toBe(false);

    // Fresh accepted truth immunizes the bundle even with a poseless scaffold on disk.
    const i = byKey("route-i/vid_8");
    expect(i.hasGroundTruth).toBe(true);
    expect(i.truthStale).toBe(false);
    expect(i.untrackable).toBe(false);
  });
});
