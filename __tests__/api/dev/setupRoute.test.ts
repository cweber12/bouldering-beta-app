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

  it("422s a labels-only save when no setup has been calibrated yet", async () => {
    const { PUT } = await importRoute("development");
    const res = await PUT(makeRequest(BUNDLE_KEY, { analysisInputs: { shadows: "low" } }));
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
