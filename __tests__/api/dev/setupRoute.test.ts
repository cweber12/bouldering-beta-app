import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";

let root: string;
let bundleDir: string;
const BUNDLE_KEY = "route-x/vid_1";

const CROPS = {
  climberCrop: { x: 0.1, y: 0.1, w: 0.3, h: 0.6 },
  wallCrop: { x: 0, y: 0, w: 1, h: 1 },
  climberPoint: { x: 0.2, y: 0.3 },
  panning: false,
  qualityTier: "balanced",
};

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "harness-setup-"));
  bundleDir = path.join(root, "route-x", "vid_1");
  await mkdir(bundleDir, { recursive: true });
});

beforeEach(async () => {
  // Fresh bundle each test: metadata present, no setup yet.
  await writeFile(path.join(bundleDir, "metadata.json"), JSON.stringify({ source_title: "clip" }));
  await rm(path.join(bundleDir, "setup.json"), { force: true });
});

afterAll(async () => {
  delete process.env.HARNESS_ANALYSIS_ROOT;
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Import the route fresh with a chosen NODE_ENV (HARNESS_ENABLED is load-time). */
async function importRoute(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  process.env.HARNESS_ANALYSIS_ROOT = root;
  return import("@/app/api/dev/corpus/setup/route");
}

function makeRequest(key: string, body?: unknown): NextRequest {
  return {
    nextUrl: new URL(`http://localhost/api/dev/corpus/setup?key=${encodeURIComponent(key)}`),
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as NextRequest;
}

async function onDisk(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(bundleDir, "setup.json"), "utf8"));
}

describe("dev GET/PUT /api/dev/corpus/setup", () => {
  it("404s outside development for both verbs", async () => {
    const { GET, PUT } = await importRoute("production");
    expect((await GET(makeRequest(BUNDLE_KEY))).status).toBe(404);
    expect((await PUT(makeRequest(BUNDLE_KEY, CROPS))).status).toBe(404);
  });

  it("GET returns null when no setup exists yet", async () => {
    const { GET } = await importRoute("development");
    const res = await GET(makeRequest(BUNDLE_KEY));
    expect(res.status).toBe(200);
    expect((await res.json()).setup).toBeNull();
  });

  it("a crops-only save writes the setup with a server hash and no labels", async () => {
    const { PUT } = await importRoute("development");
    const res = await PUT(makeRequest(BUNDLE_KEY, CROPS));
    expect(res.status).toBe(200);
    const setup = (await res.json()).setup;
    expect(setup.climberCrop).toEqual(CROPS.climberCrop);
    expect(typeof setup.setupHash).toBe("string");
    expect(setup.setupHash.length).toBe(64);
    expect(setup.analysisInputs).toBeUndefined();
  });

  it("labels persist into analysisInputs with snake_case keys and survive a crops-only save", async () => {
    const { PUT } = await importRoute("development");

    await PUT(makeRequest(BUNDLE_KEY, CROPS));
    await PUT(makeRequest(BUNDLE_KEY, { analysisInputs: { shadows: "high", route_orientation: "overhang" } }));

    // A subsequent crops-only save must preserve the labels.
    const res = await PUT(makeRequest(BUNDLE_KEY, { ...CROPS, panning: true }));
    const setup = (await res.json()).setup;
    expect(setup.panning).toBe(true);
    expect(setup.analysisInputs).toEqual({ shadows: "high", route_orientation: "overhang" });
  });

  it("a labels-only save leaves the scan fields and setupHash byte-identical", async () => {
    const { PUT } = await importRoute("development");

    await PUT(makeRequest(BUNDLE_KEY, CROPS));
    const before = await onDisk();

    const res = await PUT(makeRequest(BUNDLE_KEY, { analysisInputs: { motion_blur: "extreme" } }));
    expect(res.status).toBe(200);
    const after = await onDisk();

    // Every scan-affecting field and the hash are unchanged.
    expect(after.setupHash).toBe(before.setupHash);
    expect(after.climberCrop).toEqual(before.climberCrop);
    expect(after.wallCrop).toEqual(before.wallCrop);
    expect(after.climberPoint).toEqual(before.climberPoint);
    expect(after.panning).toBe(before.panning);
    expect(after.qualityTier).toBe(before.qualityTier);
    // Only the labels were added (an off-scale amount is retained verbatim).
    expect(after.analysisInputs).toEqual({ motion_blur: "extreme" });
  });

  it("re-saving an unchanged calibration re-derives the identical setupHash", async () => {
    // The freshness treadmill guard (harness issue #21): the hash is derived
    // from the calibration content, never from session identity or timestamps,
    // so a no-op re-save can never orphan existing Ground Truth or runs.
    const { PUT } = await importRoute("development");

    const first = (await (await PUT(makeRequest(BUNDLE_KEY, CROPS))).json()).setup;
    const again = (await (await PUT(makeRequest(BUNDLE_KEY, CROPS))).json()).setup;

    expect(again.setupHash).toBe(first.setupHash);
  });

  it("editing a label never changes setupHash", async () => {
    const { PUT } = await importRoute("development");

    const first = (await (await PUT(makeRequest(BUNDLE_KEY, CROPS))).json()).setup;
    const edited = (
      await (await PUT(makeRequest(BUNDLE_KEY, { analysisInputs: { shadows: "low" } }))).json()
    ).setup;
    const reEdited = (
      await (await PUT(makeRequest(BUNDLE_KEY, { analysisInputs: { shadows: "high" } }))).json()
    ).setup;

    expect(edited.setupHash).toBe(first.setupHash);
    expect(reEdited.setupHash).toBe(first.setupHash);
    expect(reEdited.analysisInputs).toEqual({ shadows: "high" });
  });

  it("persists label provenance beside the labels and merges it field-level", async () => {
    const { PUT } = await importRoute("development");

    await PUT(makeRequest(BUNDLE_KEY, CROPS));
    await PUT(
      makeRequest(BUNDLE_KEY, {
        analysisInputs: { shadows: "patchy", wall_contrast: "low" },
        analysisInputsProvenance: { shadows: "auto-accepted", wall_contrast: "human-overridden" },
      }),
    );
    // A later save touching one label overwrites only that entry.
    const res = await PUT(
      makeRequest(BUNDLE_KEY, {
        analysisInputs: { shadows: "climber" },
        analysisInputsProvenance: { shadows: "human-overridden" },
      }),
    );
    const setup = (await res.json()).setup;
    expect(setup.analysisInputsProvenance).toEqual({
      shadows: "human-overridden",
      wall_contrast: "human-overridden",
    });
    // Provenance survives a crops-only save and never changes the hash.
    const before = setup.setupHash;
    const after = (await (await PUT(makeRequest(BUNDLE_KEY, CROPS))).json()).setup;
    expect(after.analysisInputsProvenance).toEqual(setup.analysisInputsProvenance);
    expect(after.setupHash).toBe(before);
  });

  it("422s an off-vocabulary or mis-keyed provenance block", async () => {
    const { PUT } = await importRoute("development");
    await PUT(makeRequest(BUNDLE_KEY, CROPS));
    expect(
      (
        await PUT(
          makeRequest(BUNDLE_KEY, {
            analysisInputs: { shadows: "none" },
            analysisInputsProvenance: { shadows: "guessed" },
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await PUT(
          makeRequest(BUNDLE_KEY, {
            analysisInputs: { shadows: "none" },
            analysisInputsProvenance: { notes: "human-authored" },
          }),
        )
      ).status,
    ).toBe(422);
  });

  it("422s a labels-only save when no setup has been calibrated yet", async () => {
    const { PUT } = await importRoute("development");
    const res = await PUT(makeRequest(BUNDLE_KEY, { analysisInputs: { shadows: "low" } }));
    expect(res.status).toBe(422);
  });

  it("a seedTap-only save leaves the scan fields and setupHash byte-identical", async () => {
    const { PUT } = await importRoute("development");

    await PUT(makeRequest(BUNDLE_KEY, CROPS));
    const before = await onDisk();

    const res = await PUT(makeRequest(BUNDLE_KEY, { seedTap: { x: 0.7, y: 0.4, t: 3.2 } }));
    expect(res.status).toBe(200);
    const after = await onDisk();

    // The off-hash seed tap never touches the analysis inputs or the hash.
    expect(after.setupHash).toBe(before.setupHash);
    expect(after.climberCrop).toEqual(before.climberCrop);
    expect(after.climberPoint).toEqual(before.climberPoint);
    expect(after.seedTap).toEqual({ x: 0.7, y: 0.4, t: 3.2 });
    expect((await res.json()).setup.seedTap).toEqual({ x: 0.7, y: 0.4, t: 3.2 });
  });

  it("a seedTap survives a later crops-only save and a null clears it", async () => {
    const { PUT } = await importRoute("development");

    await PUT(makeRequest(BUNDLE_KEY, CROPS));
    await PUT(makeRequest(BUNDLE_KEY, { seedTap: { x: 0.7, y: 0.4 } }));

    // A crops-only save carries the seed tap forward.
    const kept = (await (await PUT(makeRequest(BUNDLE_KEY, { ...CROPS, panning: true }))).json())
      .setup;
    expect(kept.seedTap).toEqual({ x: 0.7, y: 0.4 });

    // An explicit null clears it back to falling through to climberPoint.
    const cleared = (await (await PUT(makeRequest(BUNDLE_KEY, { seedTap: null }))).json()).setup;
    expect(cleared.seedTap).toBeUndefined();
  });

  it("editing only the seedTap never changes setupHash", async () => {
    const { PUT } = await importRoute("development");

    const first = (await (await PUT(makeRequest(BUNDLE_KEY, CROPS))).json()).setup;
    const seeded = (
      await (await PUT(makeRequest(BUNDLE_KEY, { seedTap: { x: 0.3, y: 0.3, t: 1 } }))).json()
    ).setup;
    const reSeeded = (
      await (await PUT(makeRequest(BUNDLE_KEY, { seedTap: { x: 0.8, y: 0.8, t: 5 } }))).json()
    ).setup;

    expect(seeded.setupHash).toBe(first.setupHash);
    expect(reSeeded.setupHash).toBe(first.setupHash);
    expect(reSeeded.seedTap).toEqual({ x: 0.8, y: 0.8, t: 5 });
  });

  it("422s a malformed seedTap", async () => {
    const { PUT } = await importRoute("development");
    await PUT(makeRequest(BUNDLE_KEY, CROPS));
    const res = await PUT(makeRequest(BUNDLE_KEY, { seedTap: { x: "no", y: 0.4 } }));
    expect(res.status).toBe(422);
  });

  it("422s a seedTap-only save when no setup has been calibrated yet", async () => {
    const { PUT } = await importRoute("development");
    const res = await PUT(makeRequest(BUNDLE_KEY, { seedTap: { x: 0.5, y: 0.5 } }));
    expect(res.status).toBe(422);
  });

  it("422s a label edit that names a structural / unknown field", async () => {
    const { PUT } = await importRoute("development");
    await PUT(makeRequest(BUNDLE_KEY, CROPS));
    const res = await PUT(makeRequest(BUNDLE_KEY, { analysisInputs: { route_folder: "hijack" } }));
    expect(res.status).toBe(422);
  });

  it("422s an invalid scan input", async () => {
    const { PUT } = await importRoute("development");
    const res = await PUT(makeRequest(BUNDLE_KEY, { ...CROPS, climberCrop: { x: "no" } }));
    expect(res.status).toBe(422);
  });

  it("400s on an unsafe / malformed bundle key", async () => {
    const { GET, PUT } = await importRoute("development");
    expect((await GET(makeRequest("../escape"))).status).toBe(400);
    expect((await PUT(makeRequest("a/b/c", CROPS))).status).toBe(400);
  });

  it("404s a PUT for a bundle that has no metadata.json", async () => {
    const { PUT } = await importRoute("development");
    expect((await PUT(makeRequest("route-x/ghost", CROPS))).status).toBe(404);
  });
});
