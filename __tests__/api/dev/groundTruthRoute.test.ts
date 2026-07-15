import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";

let root: string;
let bundleDir: string;
const BUNDLE_KEY = "route-x/vid_1";

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "harness-gt-"));
  bundleDir = path.join(root, "route-x", "vid_1");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(path.join(bundleDir, "metadata.json"), JSON.stringify({ source_title: "X" }));
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
  return import("@/app/api/dev/corpus/ground-truth/route");
}

function makeRequest(key: string, body?: unknown): NextRequest {
  return {
    nextUrl: new URL(`http://localhost/api/dev/corpus/ground-truth?key=${encodeURIComponent(key)}`),
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as NextRequest;
}

const validInput = {
  setupHash: "setup-abc",
  frames: [
    {
      frameIndex: 0,
      timestamp: 0,
      state: "present",
      review: "auto",
      verified: true,
      joints: { nose: { x: 0.5, y: 0.2, occluded: false } },
    },
    { frameIndex: 3, timestamp: 0.3, state: "absent", review: "human-flagged-absent", verified: true },
  ],
};

describe("dev GET/PUT /api/dev/corpus/ground-truth", () => {
  it("404s outside development for both verbs", async () => {
    const { GET, PUT } = await importRoute("production");
    expect((await GET(makeRequest(BUNDLE_KEY))).status).toBe(404);
    expect((await PUT(makeRequest(BUNDLE_KEY, validInput))).status).toBe(404);
  });

  it("returns null when no Ground Truth exists yet", async () => {
    const { GET } = await importRoute("development");
    const res = await GET(makeRequest(BUNDLE_KEY));
    expect(res.status).toBe(200);
    expect((await res.json()).groundTruth).toBeNull();
  });

  it("PUT then GET round-trips a Ground Truth with a server-computed hash", async () => {
    const { GET, PUT } = await importRoute("development");

    const putRes = await PUT(makeRequest(BUNDLE_KEY, validInput));
    expect(putRes.status).toBe(200);
    const saved = (await putRes.json()).groundTruth;
    expect(saved.version).toBe(1);
    expect(saved.jointSet).toContain("nose");
    expect(saved.setupHash).toBe("setup-abc");
    expect(saved.frames[0].review).toBe("auto");
    expect(saved.groundTruthHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof saved.updatedAt).toBe("string");

    // Persisted to the bundle as ground-truth.json.
    const onDisk = JSON.parse(await readFile(path.join(bundleDir, "ground-truth.json"), "utf8"));
    expect(onDisk.groundTruthHash).toBe(saved.groundTruthHash);

    const getRes = await GET(makeRequest(BUNDLE_KEY));
    expect((await getRes.json()).groundTruth.groundTruthHash).toBe(saved.groundTruthHash);
  });

  it("recomputes the hash server-side, ignoring any client-sent hash", async () => {
    const { PUT } = await importRoute("development");
    const clean = await PUT(makeRequest(BUNDLE_KEY, validInput));
    const cleanHash = (await clean.json()).groundTruth.groundTruthHash;

    const spoofed = await PUT(makeRequest(BUNDLE_KEY, { ...validInput, groundTruthHash: "deadbeef" }));
    expect((await spoofed.json()).groundTruth.groundTruthHash).toBe(cleanHash);
  });

  it("422s on an invalid Ground Truth body", async () => {
    const { PUT } = await importRoute("development");
    const res = await PUT(makeRequest(BUNDLE_KEY, { frames: [{ frameIndex: -1 }] }));
    expect(res.status).toBe(422);
  });

  it("422s a write missing the required setupHash or per-frame review", async () => {
    const { PUT } = await importRoute("development");

    const noSetupHash = { frames: validInput.frames };
    expect((await PUT(makeRequest(BUNDLE_KEY, noSetupHash))).status).toBe(422);

    const noReview = {
      setupHash: "setup-abc",
      frames: [{ frameIndex: 0, timestamp: 0, state: "present", verified: true }],
    };
    expect((await PUT(makeRequest(BUNDLE_KEY, noReview))).status).toBe(422);
  });

  it("400s on an unsafe / malformed bundle key", async () => {
    const { GET, PUT } = await importRoute("development");
    expect((await GET(makeRequest("../escape"))).status).toBe(400);
    expect((await PUT(makeRequest("a/b/c", validInput))).status).toBe(400);
  });

  it("404s a PUT for a bundle that has no metadata.json", async () => {
    const { PUT } = await importRoute("development");
    // A safe key that resolves under root but is not a real bundle.
    expect((await PUT(makeRequest("route-x/ghost", validInput))).status).toBe(404);
  });
});
