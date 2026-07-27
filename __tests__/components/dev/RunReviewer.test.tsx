import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RunReviewer from "@/components/dev/RunReviewer";
import type { CorpusItem } from "@/utils/harnessCorpus";

// jsdom never fires loadedmetadata, so the real probe would hang the load.
vi.mock("@/utils/probeVideoMeta", () => ({
  probeVideoMeta: async () => ({ width: 720, height: 1280, duration: 0.3 }),
}));

const ITEM: CorpusItem = {
  key: "route-x/vid_1",
  routeFolder: "route-x",
  videoKey: "vid_1",
  title: "Clip X",
  videoPath: "analysis/route-x/vid_1/vid_1.mp4",
  hasSetup: true,
  hasGroundTruth: true,
  truthStale: false,
  seedReady: false,
  untrackable: false,
  runCount: 3,
  pairedRunCount: 2,
  unpairedRunCount: 1,
  analysisInputs: null,
};

const DIAGNOSTICS = {
  schemaVersion: 3,
  recordType: "scan",
  scanId: "scan-1",
  createdAt: "2026-07-20T00:00:00.000Z",
  videoHash: "vh",
  appVersion: "1.2.3",
  input: { video: { width: 720, height: 1280 } },
  config: { frameStep: 3 },
  result: { pose: { detectionRate: 0.9 }, orb: { refKeypointCount: 500 }, badStretches: [] },
};

const KEYPOINTS = [
  { name: "left_shoulder", x: 0.45, y: 0.3, score: 0.9 },
  { name: "left_wrist", x: 0.4, y: 0.5, score: 0.8 },
];

const CONDITIONS = {
  overall: { mean: 120.5, stdDev: 40.2, sharpness: 88.1 },
  climber: { mean: 60.4, stdDev: 20.1, sharpness: 40.5 },
  wall: null,
  flags: {
    isOverexposed: false,
    isUnderexposed: false,
    isBacklit: true,
    isLowContrast: false,
    isBlurry: false,
  },
};

function truthFrame(frameIndex: number, timestamp: number, review = "auto", state = "present") {
  return {
    frameIndex,
    timestamp,
    state,
    review,
    verified: true,
    joints: {
      left_shoulder: { x: 0.46, y: 0.31, occluded: false },
      left_wrist: { x: 0.41, y: 0.52, occluded: false },
    },
  };
}

const GROUND_TRUTH = {
  version: 1,
  jointSet: ["left_shoulder", "left_wrist"],
  setupHash: "setup-1",
  groundTruthHash: "gt-current",
  updatedAt: "2026-07-20T00:00:00.000Z",
  frames: [
    truthFrame(0, 0),
    truthFrame(1, 0.1),
    truthFrame(2, 0.2, "human-flagged-wrong"),
    truthFrame(3, 0.3),
  ],
};

function row(frameIndex: number, timestamp: number, kind: string, extra: object = {}) {
  return {
    frameIndex,
    timestamp,
    state: "present",
    kind,
    verified: true,
    bodyScale: 0.2,
    driftAvg: 0.02,
    driftMax: 0.04,
    worstJoint: "left_wrist",
    jointDrift: { left_wrist: 0.04, left_shoulder: 0.01 },
    ...extra,
  };
}

const COUNTS = {
  good: 1,
  drift: 0,
  wrong: 1,
  extreme: 0,
  missing: 1,
  unscored: 0,
  absentOk: 0,
  absentViolation: 0,
};
const EMPTY_COUNTS = { ...COUNTS, good: 0, wrong: 0, missing: 0 };

/** Scoring over three of the four grid frames — 0.3s is deliberately unprobed. */
function scoring(groundTruthHash: string) {
  return {
    groundTruthHash,
    rows: [row(0, 0, "good"), row(1, 0.1, "wrong"), row(2, 0.2, "missing")],
    rollup: {
      verified: { counts: COUNTS, drift: { min: 0.01, avg: 0.04, max: 0.09 } },
      unverified: { counts: EMPTY_COUNTS, drift: null },
      totalPresent: 4,
      probedPresent: 3,
      probeCoverage: 0.75,
      verifiedCoverage: 1,
      detectionRateVsGT: 0.66,
      offGridRunFrames: 0,
    },
  };
}

/** A current-generation run: scored, with a detector-attempt stream. */
function modernRun(groundTruthHash = "gt-current") {
  return {
    setupHash: "setup-1",
    groundTruthHash,
    scoring: scoring(groundTruthHash),
    diagnostics: DIAGNOSTICS,
    detectorAttempts: [
      {
        timestamp: 0,
        status: "accepted",
        initialSearchRegion: { x: 0.1, y: 0.1, w: 0.4, h: 0.6 },
        detectionRegion: { x: 0.15, y: 0.15, w: 0.3, h: 0.5 },
        reacquireAttempted: false,
        reacquired: false,
        rawKeypoints: KEYPOINTS,
        acceptedKeypoints: KEYPOINTS,
        searchConditions: CONDITIONS,
        reacquireConditions: null,
        candidateCount: 2,
        rejectedCandidateCount: 1,
        selectionMethod: "tracked",
        inferenceMs: 14.2,
      },
      {
        timestamp: 0.1,
        status: "missing",
        initialSearchRegion: { x: 0.1, y: 0.1, w: 0.4, h: 0.6 },
        detectionRegion: null,
        reacquireAttempted: true,
        reacquired: false,
        reacquireSteps: [{ region: { x: 0, y: 0, w: 1, h: 1 }, found: false }],
        rawKeypoints: [],
        searchConditions: CONDITIONS,
        reacquireConditions: null,
        candidateCount: 0,
        rejectedCandidateCount: 0,
        missReason: "no-candidates",
      },
    ],
    frames: [
      { timestamp: 0, source: "raw", keypoints: KEYPOINTS },
      { timestamp: 0.2, source: "raw", keypoints: KEYPOINTS },
    ],
  };
}

/** A v1 run: written before the detector-attempt stream existed. */
function legacyRun() {
  return {
    setupHash: "setup-1",
    groundTruthHash: "gt-current",
    scoring: scoring("gt-current"),
    diagnostics: DIAGNOSTICS,
    frames: [{ timestamp: 0, keypoints: KEYPOINTS }],
  };
}

const RUNS = [
  // Newest, but scanned under a different calibration — never the default.
  {
    runTs: "20260103-000000",
    writtenAt: "2026-01-03T00:00:00",
    setupHash: "setup-2",
    groundTruthHash: null,
    pairsWithTruth: false,
    verdicts: null,
    malformed: false,
  },
  {
    runTs: "20260102-000000",
    writtenAt: "2026-01-02T00:00:00",
    setupHash: "setup-1",
    groundTruthHash: "gt-current",
    pairsWithTruth: true,
    verdicts: { verified: COUNTS, unverified: EMPTY_COUNTS },
    malformed: false,
  },
  // Paired, but scored against a Ground Truth version that has since been edited.
  {
    runTs: "20260101-000000",
    writtenAt: "2026-01-01T00:00:00",
    setupHash: "setup-1",
    groundTruthHash: "gt-old",
    pairsWithTruth: true,
    verdicts: { verified: COUNTS, unverified: EMPTY_COUNTS },
    malformed: false,
  },
];

interface StubOptions {
  runs?: typeof RUNS;
  /** Payload per runTs; defaults to the modern run for every id. */
  payloads?: Record<string, unknown>;
  groundTruth?: unknown;
}

function stubFetch({ runs = RUNS, payloads, groundTruth = GROUND_TRUTH }: StubOptions = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/dev/corpus/video")) {
        return { ok: true, blob: async () => new Blob(["video"]) } as unknown as Response;
      }
      if (url.startsWith("/api/dev/corpus/ground-truth")) {
        return { ok: true, json: async () => ({ groundTruth }) } as unknown as Response;
      }
      const runTs = new URL(url, "http://x").searchParams.get("run");
      if (runTs === null) {
        return { ok: true, json: async () => ({ runs }) } as unknown as Response;
      }
      const run = payloads?.[runTs] ?? modernRun();
      return { ok: true, json: async () => ({ run }) } as unknown as Response;
    }),
  );
}

/** Render and wait for the video, truth and run list to settle. */
async function renderReviewer(options?: StubOptions) {
  stubFetch(options);
  const onBack = vi.fn();
  render(<RunReviewer item={ITEM} onBack={onBack} />);
  await waitFor(() => expect(screen.getByLabelText("Detection run")).toBeTruthy());
  return { onBack };
}

function runSelect(): HTMLSelectElement {
  return screen.getByLabelText("Detection run") as HTMLSelectElement;
}

/** Step the film strip forward `n` frames. */
function stepForward(n: number) {
  for (let i = 0; i < n; i += 1) {
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
  }
}

beforeEach(() => {
  if (!URL.createObjectURL) URL.createObjectURL = () => "";
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:v1");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RunReviewer", () => {
  it("defaults to the newest run that pairs with current truth, not the newest run", async () => {
    await renderReviewer();
    expect(runSelect().value).toBe("20260102-000000");
  });

  it("marks unpaired runs and runs scored against a superseded Ground Truth", async () => {
    await renderReviewer();
    const labels = Array.from(runSelect().options).map((o) => o.textContent);
    expect(labels).toEqual([
      "20260103-000000 · unpaired",
      "20260102-000000",
      "20260101-000000 · re-score",
    ]);
  });

  it("warns when the selected run was scored against a superseded truth version", async () => {
    await renderReviewer();
    expect(screen.queryByText(/superseded Ground Truth version/i)).toBeNull();

    fireEvent.change(runSelect(), { target: { value: "20260101-000000" } });
    await waitFor(() => {
      expect(screen.getByText(/superseded Ground Truth version/i)).toBeTruthy();
    });
  });

  it("shows the frame's verdict, truth provenance and attempt evidence together", async () => {
    await renderReviewer();
    await waitFor(() => expect(screen.getByTestId("verdict-chip").textContent).toBe("good"));

    // Frame 0: accepted attempt, auto truth, its search conditions.
    expect(screen.getByTestId("truth-review").textContent).toBe("auto");
    expect(screen.getByText("tracked")).toBeTruthy();
    expect(screen.getByText("isBacklit")).toBeTruthy();
    expect(screen.getByText("120.5")).toBeTruthy();
  });

  it("steps the verdict, the truth provenance and the attempt together", async () => {
    await renderReviewer();
    await waitFor(() => expect(screen.getByTestId("verdict-chip").textContent).toBe("good"));

    // Frame 1 (0.1s): a wrong verdict over a missing attempt.
    stepForward(1);
    await waitFor(() => expect(screen.getByTestId("verdict-chip").textContent).toBe("wrong"));
    expect(screen.getByText("no-candidates")).toBeTruthy();

    // Frame 2 (0.2s): the truth itself is flagged wrong.
    stepForward(1);
    await waitFor(() => expect(screen.getByTestId("verdict-chip").textContent).toBe("missing"));
    expect(screen.getByTestId("truth-review").textContent).toBe("human-flagged-wrong");
  });

  it("renders an unprobed frame as carrying no verdict rather than as a silent gap", async () => {
    await renderReviewer();
    await waitFor(() => expect(screen.getByTestId("verdict-chip")).toBeTruthy());

    // 0.3s is on the grid and has authored truth, but the run never probed it.
    stepForward(3);
    await waitFor(() => expect(screen.queryByTestId("verdict-chip")).toBeNull());
    expect(screen.getByText(/No scored row for this frame/i)).toBeTruthy();
    expect(screen.getByText(/not probed by the run/i)).toBeTruthy();
    // The truth is still there to compare against.
    expect(screen.getByTestId("truth-review").textContent).toBe("auto");
  });

  it("degrades to scoring-only for a run written before detectorAttempts", async () => {
    await renderReviewer({ payloads: { "20260102-000000": legacyRun() } });
    await waitFor(() => expect(screen.getByTestId("verdict-chip").textContent).toBe("good"));

    expect(screen.getByText(/predates the detector-attempt stream/i)).toBeTruthy();
    // No error, and the scoring evidence is still fully rendered.
    expect(screen.getByLabelText("Scoring vs Ground Truth")).toBeTruthy();
    expect(screen.getByText(/drift max/i)).toBeTruthy();
  });

  it("disables the raw pose layer when the run recorded no detector attempts", async () => {
    await renderReviewer({ payloads: { "20260102-000000": legacyRun() } });
    await waitFor(() => expect(screen.getByTestId("verdict-chip")).toBeTruthy());

    expect(screen.getByRole("button", { name: "raw" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "accepted" }).hasAttribute("disabled")).toBe(false);
  });

  it("lets either overlay pose be hidden", async () => {
    await renderReviewer();
    const truth = screen.getByLabelText("Ground Truth") as HTMLInputElement;
    const run = screen.getByLabelText("Run pose") as HTMLInputElement;
    expect(truth.checked).toBe(true);
    expect(run.checked).toBe(true);

    fireEvent.click(truth);
    fireEvent.click(run);
    expect((screen.getByLabelText("Ground Truth") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Run pose") as HTMLInputElement).checked).toBe(false);
  });

  it("switches payloads when another run is selected", async () => {
    await renderReviewer({
      payloads: {
        "20260102-000000": modernRun(),
        "20260103-000000": legacyRun(),
      },
    });
    await waitFor(() => expect(screen.getByText("tracked")).toBeTruthy());

    fireEvent.change(runSelect(), { target: { value: "20260103-000000" } });
    await waitFor(() => {
      expect(screen.getByText(/predates the detector-attempt stream/i)).toBeTruthy();
    });
    expect(screen.queryByText("tracked")).toBeNull();
  });

  it("reports a run that will not open instead of rendering a partial frame", async () => {
    stubFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/dev/corpus/video")) {
          return { ok: true, blob: async () => new Blob(["video"]) } as unknown as Response;
        }
        if (url.startsWith("/api/dev/corpus/ground-truth")) {
          return { ok: true, json: async () => ({ groundTruth: GROUND_TRUTH }) } as unknown as Response;
        }
        if (new URL(url, "http://x").searchParams.get("run") === null) {
          return { ok: true, json: async () => ({ runs: RUNS }) } as unknown as Response;
        }
        return {
          ok: false,
          json: async () => ({ error: "The run payload has no setupHash." }),
        } as unknown as Response;
      }),
    );
    render(<RunReviewer item={ITEM} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("The run payload has no setupHash.")).toBeTruthy();
    });
    expect(screen.queryByTestId("verdict-chip")).toBeNull();
  });

  it("says so when the Bundle has no posted run", async () => {
    await renderReviewer({ runs: [] });
    expect(screen.getByText(/no posted detection run/i)).toBeTruthy();
    expect(runSelect().hasAttribute("disabled")).toBe(true);
  });
});
