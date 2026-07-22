import { describe, it, expect, afterEach, vi } from "vitest";
import {
  viTPoseToPoseFrames,
  parseViTPoseScaffold,
  loadViTPose,
  requestViTPoseScaffold,
  scaffoldHasPose,
  VITPOSE_TO_MP_NAME,
  type ViTPoseScaffold,
} from "@/utils/harnessViTPose";

const scaffold: ViTPoseScaffold = {
  version: 1,
  frames: [
    {
      timestamp: 0.0,
      keypoints: [
        { name: "nose", x: 0.5, y: 0.1, score: 0.9 },
        { name: "left_wrist", x: 0.4, y: 0.6, score: 0.2 },
      ],
    },
    { timestamp: 0.5, keypoints: [] },
  ],
};

describe("viTPoseToPoseFrames", () => {
  it("maps ViTPose frames to PoseFrames, carrying position and confidence", () => {
    const frames = viTPoseToPoseFrames(scaffold);
    expect(frames).toHaveLength(2);
    expect(frames[0].timestamp).toBe(0.0);
    expect(frames[0].keypoints).toEqual([
      { name: "nose", x: 0.5, y: 0.1, score: 0.9 },
      { name: "left_wrist", x: 0.4, y: 0.6, score: 0.2 },
    ]);
    // An empty tracker frame maps to a pose with no keypoints (→ absent later).
    expect(frames[1].keypoints).toEqual([]);
  });

  it("applies the ViTPose→MediaPipe name alias when one is defined", () => {
    // The core joint names coincide today, so the alias map is a passthrough.
    expect(VITPOSE_TO_MP_NAME).toEqual({});
    const frames = viTPoseToPoseFrames({
      version: 1,
      frames: [{ timestamp: 0, keypoints: [{ name: "nose", x: 0.5, y: 0.1, score: 0.9 }] }],
    });
    expect(frames[0].keypoints[0].name).toBe("nose");
  });
});

describe("scaffoldHasPose", () => {
  it("is true when any frame posed the Climber", () => {
    expect(scaffoldHasPose(scaffold)).toBe(true);
  });

  it("is false when every frame is tracker-empty (a missed Climber)", () => {
    expect(
      scaffoldHasPose({
        version: 1,
        frames: [
          { timestamp: 0, keypoints: [] },
          { timestamp: 1, keypoints: [] },
        ],
      }),
    ).toBe(false);
  });
});

describe("loadViTPose", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubResponse(body: unknown, ok = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
    );
  }

  it("returns the scaffold once the artifact lands", async () => {
    stubResponse({ vitpose: scaffold });
    expect(await loadViTPose("route-x/vid_1")).toEqual({
      scaffold,
      error: null,
      warnings: [],
      seedFound: null,
    });
  });

  it("returns pending (both null) while the job is still running", async () => {
    stubResponse({ vitpose: null, error: null });
    expect(await loadViTPose("route-x/vid_1")).toEqual({
      scaffold: null,
      error: null,
      warnings: [],
      seedFound: null,
    });
  });

  it("surfaces a terminal job error from the proxy", async () => {
    stubResponse({ vitpose: null, error: "boom" });
    expect(await loadViTPose("route-x/vid_1")).toEqual({
      scaffold: null,
      error: "boom",
      warnings: [],
      seedFound: null,
    });
  });

  it("surfaces downloader warnings alongside a completed scaffold", async () => {
    stubResponse({ vitpose: scaffold, warnings: ["climber_point.t is missing", "ambiguous tap"] });
    expect(await loadViTPose("route-x/vid_1")).toEqual({
      scaffold,
      error: null,
      warnings: ["climber_point.t is missing", "ambiguous tap"],
      seedFound: null,
    });
  });

  it("drops non-string and empty warning entries", async () => {
    stubResponse({ vitpose: null, error: null, warnings: ["ok", 42, null, ""] });
    expect((await loadViTPose("route-x/vid_1")).warnings).toEqual(["ok"]);
  });

  it("throws when the proxy request fails", async () => {
    stubResponse({}, false);
    await expect(loadViTPose("route-x/vid_1")).rejects.toThrow();
  });
});

describe("requestViTPoseScaffold", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the request body carrying the Seed tap + region", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        ({ ok: true, json: async () => ({}) }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestViTPoseScaffold("route-x/vid_1", {
      videoPath: "analysis/route-x/vid_1/vid_1.mp4",
      seedTap: { x: 0.5, y: 0.4, t: 2.3 },
      seedRegion: { x: 0.35, y: 0.25, w: 0.3, h: 0.3 },
      climberCrop: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
      wallCrop: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
      panning: false,
      frames: [{ timestamp: 0 }, { timestamp: 0.1 }],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init!.body as string);
    expect(sent.seedTap).toEqual({ x: 0.5, y: 0.4, t: 2.3 });
    expect(sent.seedRegion).toEqual({ x: 0.35, y: 0.25, w: 0.3, h: 0.3 });
  });

  it("throws with the proxy's error message on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "nope" }) }) as unknown as Response),
    );
    await expect(
      requestViTPoseScaffold("route-x/vid_1", {
        videoPath: "v",
        seedRegion: { x: 0, y: 0, w: 1, h: 1 },
        climberCrop: { x: 0, y: 0, w: 1, h: 1 },
        wallCrop: { x: 0, y: 0, w: 1, h: 1 },
        panning: false,
        frames: [{ timestamp: 0 }],
      }),
    ).rejects.toThrow("nope");
  });
});

describe("parseViTPoseScaffold", () => {
  it("accepts a well-formed scaffold", () => {
    expect(parseViTPoseScaffold(scaffold)).toEqual(scaffold);
  });

  it("accepts an optional setupHash on newer artifacts", () => {
    expect(parseViTPoseScaffold({ ...scaffold, setupHash: "setup-123" })).toEqual({
      ...scaffold,
      setupHash: "setup-123",
    });
  });

  it("rejects a non-object, a missing version, and a non-array frames", () => {
    expect(parseViTPoseScaffold(null)).toBeNull();
    expect(parseViTPoseScaffold({ frames: [] })).toBeNull();
    expect(parseViTPoseScaffold({ version: 1, frames: {} })).toBeNull();
    expect(parseViTPoseScaffold({ version: 1, setupHash: 123, frames: [] })).toBeNull();
  });

  it("rejects a malformed keypoint or frame", () => {
    expect(
      parseViTPoseScaffold({
        version: 1,
        frames: [{ timestamp: 0, keypoints: [{ name: "nose", x: 0.5, y: "nope", score: 0.9 }] }],
      }),
    ).toBeNull();
    expect(
      parseViTPoseScaffold({ version: 1, frames: [{ timestamp: -1, keypoints: [] }] }),
    ).toBeNull();
    expect(
      parseViTPoseScaffold({
        version: 1,
        frames: [{ timestamp: 0, keypoints: [{ name: "", x: 0.5, y: 0.1, score: 0.9 }] }],
      }),
    ).toBeNull();
  });
});
