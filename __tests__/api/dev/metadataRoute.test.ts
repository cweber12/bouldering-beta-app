import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";

let root: string;
let bundleDir: string;
const BUNDLE_KEY = "route-x/vid_1";

const INITIAL_METADATA = {
  source_title: "clip",
  route_folder: "route-x",
  imported_from: "downloader",
  analysis_inputs: {
    shadows: "low",
    occlusion: "none",
    camera_angle: "low-angle",
    extra_field: "keep-me",
  },
};

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "harness-meta-"));
  bundleDir = path.join(root, "route-x", "vid_1");
  await mkdir(bundleDir, { recursive: true });
});

beforeEach(async () => {
  // Fresh metadata for each test so writes do not leak across cases.
  await writeFile(path.join(bundleDir, "metadata.json"), JSON.stringify(INITIAL_METADATA));
});

afterAll(async () => {
  delete process.env.HARNESS_ANALYSIS_ROOT;
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function importRoute(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  process.env.HARNESS_ANALYSIS_ROOT = root;
  return import("@/app/api/dev/corpus/metadata/route");
}

function makeRequest(key: string, body?: unknown): NextRequest {
  return {
    nextUrl: new URL(`http://localhost/api/dev/corpus/metadata?key=${encodeURIComponent(key)}`),
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as NextRequest;
}

describe("dev GET/PUT /api/dev/corpus/metadata", () => {
  it("404s outside development for both verbs", async () => {
    const { GET, PUT } = await importRoute("production");
    expect((await GET(makeRequest(BUNDLE_KEY))).status).toBe(404);
    expect(
      (await PUT(makeRequest(BUNDLE_KEY, { analysisInputs: { shadows: "high" } }))).status,
    ).toBe(404);
  });

  it("GET returns the analysis_inputs block", async () => {
    const { GET } = await importRoute("development");
    const res = await GET(makeRequest(BUNDLE_KEY));
    expect(res.status).toBe(200);
    expect((await res.json()).analysisInputs).toEqual(INITIAL_METADATA.analysis_inputs);
  });

  it("PUT field-level merges, preserving all other keys and unedited fields", async () => {
    const { PUT } = await importRoute("development");
    const res = await PUT(
      makeRequest(BUNDLE_KEY, { analysisInputs: { shadows: "high", notes: "backlit" } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).analysisInputs).toMatchObject({ shadows: "high", notes: "backlit" });

    const onDisk = JSON.parse(await readFile(path.join(bundleDir, "metadata.json"), "utf8"));
    // Downloader-owned top-level keys preserved verbatim.
    expect(onDisk.route_folder).toBe("route-x");
    expect(onDisk.imported_from).toBe("downloader");
    expect(onDisk.source_title).toBe("clip");
    // Only edited fields changed; the rest of analysis_inputs preserved.
    expect(onDisk.analysis_inputs.shadows).toBe("high");
    expect(onDisk.analysis_inputs.notes).toBe("backlit");
    expect(onDisk.analysis_inputs.occlusion).toBe("none");
    expect(onDisk.analysis_inputs.camera_angle).toBe("low-angle");
    expect(onDisk.analysis_inputs.extra_field).toBe("keep-me");
  });

  it("retains an off-scale amount value written back", async () => {
    const { PUT } = await importRoute("development");
    const res = await PUT(makeRequest(BUNDLE_KEY, { analysisInputs: { motion_blur: "extreme" } }));
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(await readFile(path.join(bundleDir, "metadata.json"), "utf8"));
    expect(onDisk.analysis_inputs.motion_blur).toBe("extreme");
  });

  it("422s on an invalid edit (unknown field)", async () => {
    const { PUT } = await importRoute("development");
    const res = await PUT(makeRequest(BUNDLE_KEY, { analysisInputs: { route_folder: "hijack" } }));
    expect(res.status).toBe(422);
  });

  it("400s on an unsafe / malformed bundle key", async () => {
    const { GET, PUT } = await importRoute("development");
    expect((await GET(makeRequest("../escape"))).status).toBe(400);
    expect(
      (await PUT(makeRequest("a/b/c", { analysisInputs: { shadows: "low" } }))).status,
    ).toBe(400);
  });

  it("404s for a bundle that has no metadata.json", async () => {
    const { GET, PUT } = await importRoute("development");
    expect((await GET(makeRequest("route-x/ghost"))).status).toBe(404);
    expect(
      (await PUT(makeRequest("route-x/ghost", { analysisInputs: { shadows: "low" } }))).status,
    ).toBe(404);
  });
});
