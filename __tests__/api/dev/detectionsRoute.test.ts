import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";
import type { HarnessRunSummary } from "@/utils/harnessRuns";

let root: string;
let bundleDir: string;
let runsDir: string;
const BUNDLE_KEY = "route-x/vid_1";

const DIAGNOSTICS = {
  schemaVersion: 3,
  recordType: "scan",
  scanId: "scan-1",
  createdAt: "2026-07-20T00:00:00.000Z",
  videoHash: "vh",
  appVersion: "1.2.3",
  input: { video: { width: 1080, height: 1920 } },
  config: { frameStep: 3 },
  result: { pose: { detectionRate: 0.9 }, orb: { refKeypointCount: 500 }, badStretches: [] },
};

const KEYPOINTS = [{ name: "left_wrist", x: 0.4, y: 0.5, score: 0.9 }];
const REGION = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

const COUNTS = {
  good: 4,
  drift: 3,
  wrong: 2,
  extreme: 1,
  missing: 1,
  unscored: 0,
  absentOk: 5,
  absentViolation: 1,
};
const EMPTY_COUNTS = {
  good: 0,
  drift: 0,
  wrong: 0,
  extreme: 0,
  missing: 0,
  unscored: 0,
  absentOk: 0,
  absentViolation: 0,
};

const SCORING = {
  groundTruthHash: "gt-1",
  rows: [
    {
      frameIndex: 0,
      timestamp: 0,
      state: "present",
      kind: "good",
      verified: true,
      bodyScale: 0.2,
      driftAvg: 0.01,
      driftMax: 0.03,
      worstJoint: "left_wrist",
      jointDrift: { left_wrist: 0.03 },
    },
  ],
  rollup: {
    verified: { counts: COUNTS, drift: { min: 0.01, avg: 0.05, max: 0.3 } },
    unverified: { counts: EMPTY_COUNTS, drift: null },
    totalPresent: 10,
    probedPresent: 10,
    probeCoverage: 1,
    verifiedCoverage: 1,
    detectionRateVsGT: 0.9,
    offGridRunFrames: 0,
  },
};

/** A current-generation run: scored, with a detector-attempt stream. */
function scoredPayload(setupHash: string): Record<string, unknown> {
  return {
    setupHash,
    groundTruthHash: "gt-1",
    scoring: SCORING,
    diagnostics: DIAGNOSTICS,
    detectorAttempts: [
      {
        timestamp: 0,
        status: "accepted",
        initialSearchRegion: REGION,
        detectionRegion: REGION,
        reacquireAttempted: false,
        reacquired: false,
        rawKeypoints: KEYPOINTS,
        acceptedKeypoints: KEYPOINTS,
        searchConditions: null,
        reacquireConditions: null,
        candidateCount: 1,
        rejectedCandidateCount: 0,
        selectionMethod: "tracked",
      },
    ],
    frames: [{ timestamp: 0, source: "raw", keypoints: KEYPOINTS }],
  };
}

/** A v1 run: no detectorAttempts, no scoring, no groundTruthHash. */
function legacyPayload(setupHash: string): Record<string, unknown> {
  return {
    setupHash,
    scoring: null,
    diagnostics: DIAGNOSTICS,
    frames: [{ timestamp: 0, keypoints: KEYPOINTS }],
  };
}

async function writeRun(runTs: string, data: unknown, writtenAt?: string): Promise<void> {
  await writeFile(
    path.join(runsDir, `${runTs}_pose.json`),
    JSON.stringify({
      video_key: "vid_1",
      route_folder: "route-x",
      run_ts: runTs,
      ...(writtenAt ? { written_at: writtenAt } : {}),
      type: "pose",
      data,
    }),
  );
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "harness-detections-"));
  bundleDir = path.join(root, "route-x", "vid_1");
  runsDir = path.join(bundleDir, "detections");
  await mkdir(runsDir, { recursive: true });
});

beforeEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
  await mkdir(runsDir, { recursive: true });
  await writeFile(path.join(bundleDir, "metadata.json"), JSON.stringify({ source_title: "clip" }));
  await writeFile(path.join(bundleDir, "setup.json"), JSON.stringify({ setupHash: "setup-1" }));
  await writeFile(
    path.join(bundleDir, "ground-truth.json"),
    JSON.stringify({ setupHash: "setup-1", frames: [] }),
  );
});

afterAll(async () => {
  delete process.env.HARNESS_ANALYSIS_ROOT;
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Import the route fresh with a chosen NODE_ENV (HARNESS_ENABLED is load-time). */
async function importRoute(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  process.env.HARNESS_ANALYSIS_ROOT = root;
  process.env.HARNESS_API_BASE = "http://downloader.test";
  return import("@/app/api/dev/detections/route");
}

function getRequest(key: string, run?: string): NextRequest {
  const url = new URL(`http://localhost/api/dev/detections?key=${encodeURIComponent(key)}`);
  if (run !== undefined) url.searchParams.set("run", run);
  return { nextUrl: url } as unknown as NextRequest;
}

function postRequest(body: unknown): NextRequest {
  return {
    nextUrl: new URL("http://localhost/api/dev/detections"),
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as NextRequest;
}

describe("dev GET /api/dev/detections", () => {
  it("404s outside development", async () => {
    const { GET } = await importRoute("production");
    expect((await GET(getRequest(BUNDLE_KEY))).status).toBe(404);
    expect((await GET(getRequest(BUNDLE_KEY, "20260101-000000"))).status).toBe(404);
  });

  it("400s an invalid or traversing bundle key", async () => {
    const { GET } = await importRoute("development");
    expect((await GET(getRequest("../escape"))).status).toBe(400);
    expect((await GET(getRequest("a/b/c"))).status).toBe(400);
    expect((await GET(getRequest(""))).status).toBe(400);
  });

  it("lists the bundle's runs newest first with stamps and verdict counts", async () => {
    await writeRun("20260101-000000", scoredPayload("setup-1"), "2026-01-01T00:00:00");
    await writeRun("20260103-120000", scoredPayload("setup-1"), "2026-01-03T12:00:00");
    await writeRun("20260102-000000", legacyPayload("setup-1"), "2026-01-02T00:00:00");

    const { GET } = await importRoute("development");
    const res = await GET(getRequest(BUNDLE_KEY));
    expect(res.status).toBe(200);
    const runs = (await res.json()).runs as HarnessRunSummary[];

    expect(runs.map((r) => r.runTs)).toEqual([
      "20260103-120000",
      "20260102-000000",
      "20260101-000000",
    ]);
    expect(runs[0]).toEqual({
      runTs: "20260103-120000",
      writtenAt: "2026-01-03T12:00:00",
      setupHash: "setup-1",
      groundTruthHash: "gt-1",
      pairsWithTruth: true,
      verdicts: { verified: COUNTS, unverified: EMPTY_COUNTS },
      malformed: false,
    });
    // The legacy run lists with the fields it has and nulls for the rest.
    expect(runs[1].groundTruthHash).toBeNull();
    expect(runs[1].verdicts).toBeNull();
    expect(runs[1].malformed).toBe(false);
  });

  it("never puts frames or detector attempts on the list response", async () => {
    await writeRun("20260101-000000", scoredPayload("setup-1"));
    const { GET } = await importRoute("development");
    const body = await (await GET(getRequest(BUNDLE_KEY))).json();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("frames");
    expect(serialized).not.toContain("detectorAttempts");
    expect(serialized).not.toContain("keypoints");
  });

  it("flags a run scanned under a different calibration as unpaired", async () => {
    await writeRun("20260101-000000", scoredPayload("setup-1"));
    await writeRun("20260102-000000", scoredPayload("setup-2"));

    const { GET } = await importRoute("development");
    const runs = (await (await GET(getRequest(BUNDLE_KEY))).json()).runs as HarnessRunSummary[];
    expect(runs.find((r) => r.runTs === "20260101-000000")?.pairsWithTruth).toBe(true);
    expect(runs.find((r) => r.runTs === "20260102-000000")?.pairsWithTruth).toBe(false);
  });

  it("pairs nothing on a bundle with no Ground Truth", async () => {
    await rm(path.join(bundleDir, "ground-truth.json"));
    await writeRun("20260101-000000", scoredPayload("setup-1"));

    const { GET } = await importRoute("development");
    const runs = (await (await GET(getRequest(BUNDLE_KEY))).json()).runs as HarnessRunSummary[];
    expect(runs[0].pairsWithTruth).toBe(false);
  });

  it("lists a malformed run flagged rather than dropping it or throwing", async () => {
    await writeRun("20260101-000000", scoredPayload("setup-1"));
    await writeFile(path.join(runsDir, "20260102-000000_pose.json"), '{"video_key": "vid_1"');

    const { GET } = await importRoute("development");
    const runs = (await (await GET(getRequest(BUNDLE_KEY))).json()).runs as HarnessRunSummary[];
    expect(runs).toHaveLength(2);
    const broken = runs.find((r) => r.runTs === "20260102-000000");
    expect(broken?.malformed).toBe(true);
    expect(broken?.setupHash).toBeNull();
  });

  it("returns an empty list for a bundle that has never been analyzed", async () => {
    const { GET } = await importRoute("development");
    expect((await (await GET(getRequest(BUNDLE_KEY))).json()).runs).toEqual([]);
  });

  it("returns one run's full payload", async () => {
    await writeRun("20260101-000000", scoredPayload("setup-1"));
    const { GET } = await importRoute("development");
    const res = await GET(getRequest(BUNDLE_KEY, "20260101-000000"));
    expect(res.status).toBe(200);

    const run = (await res.json()).run;
    expect(run.setupHash).toBe("setup-1");
    expect(run.scoring.rollup.verified.counts).toEqual(COUNTS);
    expect(run.detectorAttempts).toHaveLength(1);
    expect(run.frames).toHaveLength(1);
  });

  it("loads a run written before detectorAttempts / missReason / selectionMethod existed", async () => {
    await writeRun("20260101-000000", legacyPayload("setup-1"));
    const { GET } = await importRoute("development");
    const res = await GET(getRequest(BUNDLE_KEY, "20260101-000000"));
    expect(res.status).toBe(200);

    const run = (await res.json()).run;
    expect(run.detectorAttempts).toBeUndefined();
    expect(run.scoring).toBeNull();
    expect(run.groundTruthHash).toBeNull();
    expect(run.frames).toHaveLength(1);
  });

  it("404s an unknown run", async () => {
    const { GET } = await importRoute("development");
    expect((await GET(getRequest(BUNDLE_KEY, "20260101-000000"))).status).toBe(404);
  });

  it("400s a traversing run identifier", async () => {
    const { GET } = await importRoute("development");
    expect((await GET(getRequest(BUNDLE_KEY, "../../setup"))).status).toBe(400);
    expect((await GET(getRequest(BUNDLE_KEY, ".."))).status).toBe(400);
  });

  it("422s a truncated run file with a reason", async () => {
    await writeFile(path.join(runsDir, "20260101-000000_pose.json"), '{"video_key": "vid_1"');
    const { GET } = await importRoute("development");
    const res = await GET(getRequest(BUNDLE_KEY, "20260101-000000"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/JSON/);
  });

  it("422s a run file whose payload is missing a required field", async () => {
    const gutted = scoredPayload("setup-1");
    delete gutted.diagnostics;
    await writeRun("20260101-000000", gutted);

    const { GET } = await importRoute("development");
    const res = await GET(getRequest(BUNDLE_KEY, "20260101-000000"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/diagnostics/);
  });
});

describe("dev POST /api/dev/detections", () => {
  it("still relays the run verbatim to the downloader", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ run_id: "20260101-000000" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await importRoute("development");
    const body = { video_path: "analysis/route-x/vid_1/vid_1.mp4", pose: { a: 1 }, orb: { b: 2 } };
    const res = await POST(postRequest(body));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ run_id: "20260101-000000" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://downloader.test/api/detections");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("still 404s outside development and 422s an incomplete body", async () => {
    const { POST: prodPost } = await importRoute("production");
    expect((await prodPost(postRequest({ video_path: "x", pose: {}, orb: {} }))).status).toBe(404);

    const { POST } = await importRoute("development");
    expect((await POST(postRequest({ video_path: "x", pose: {} }))).status).toBe(422);
  });
});
