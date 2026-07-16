import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

let root: string;
let bundleDir: string;
const BUNDLE_KEY = "route-x/vid_1";

const validScaffold = {
  version: 1,
  frames: [{ timestamp: 0, keypoints: [{ name: "nose", x: 0.5, y: 0.1, score: 0.9 }] }],
};

const validRequest = {
  videoPath: "analysis/route-x/vid_1/vid_1.mp4",
  climberPoint: { x: 0.5, y: 0.4, t: 2.33 },
  climberCrop: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
  wallCrop: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
  panning: false,
  frames: [{ timestamp: 0 }, { timestamp: 0.5 }],
};

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "harness-vitpose-"));
  bundleDir = path.join(root, "route-x", "vid_1");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(path.join(bundleDir, "metadata.json"), JSON.stringify({ source_title: "X" }));
});

afterAll(async () => {
  delete process.env.HARNESS_ANALYSIS_ROOT;
  delete process.env.HARNESS_API_BASE;
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete process.env.HARNESS_API_BASE;
});

async function importRoute(nodeEnv: string, apiBase?: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  process.env.HARNESS_ANALYSIS_ROOT = root;
  if (apiBase) process.env.HARNESS_API_BASE = apiBase;
  return import("@/app/api/dev/corpus/vitpose/route");
}

function makeRequest(key: string, body?: unknown): NextRequest {
  return {
    nextUrl: new URL(`http://localhost/api/dev/corpus/vitpose?key=${encodeURIComponent(key)}`),
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as NextRequest;
}

describe("dev GET/POST /api/dev/corpus/vitpose", () => {
  it("404s outside development for both verbs", async () => {
    const { GET, POST } = await importRoute("production");
    expect((await GET(makeRequest(BUNDLE_KEY))).status).toBe(404);
    expect((await POST(makeRequest(BUNDLE_KEY, validRequest))).status).toBe(404);
  });

  it("GET returns null while the job is still running (no artifact yet)", async () => {
    const { GET } = await importRoute("development");
    const res = await GET(makeRequest(BUNDLE_KEY));
    expect(res.status).toBe(200);
    expect((await res.json()).vitpose).toBeNull();
  });

  it("GET returns the parsed scaffold once vitpose.json exists", async () => {
    const { GET } = await importRoute("development");
    await writeFile(path.join(bundleDir, "vitpose.json"), JSON.stringify(validScaffold));
    const res = await GET(makeRequest(BUNDLE_KEY));
    expect(res.status).toBe(200);
    expect((await res.json()).vitpose).toEqual(validScaffold);
    await rm(path.join(bundleDir, "vitpose.json"), { force: true });
  });

  it("GET 422s on a malformed vitpose.json", async () => {
    const { GET } = await importRoute("development");
    await writeFile(path.join(bundleDir, "vitpose.json"), JSON.stringify({ frames: "bad" }));
    expect((await GET(makeRequest(BUNDLE_KEY))).status).toBe(422);
    await rm(path.join(bundleDir, "vitpose.json"), { force: true });
  });

  it("GET surfaces a terminal job error from the status sidecar when no artifact exists", async () => {
    const { GET } = await importRoute("development");
    await writeFile(
      path.join(bundleDir, "vitpose.status.json"),
      JSON.stringify({ jobId: "j1", status: "error", error: "boom" }),
    );
    const res = await GET(makeRequest(BUNDLE_KEY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vitpose).toBeNull();
    expect(body.error).toBe("boom");
    await rm(path.join(bundleDir, "vitpose.status.json"), { force: true });
  });

  it("GET reports no error while the job is still running (non-error status)", async () => {
    const { GET } = await importRoute("development");
    await writeFile(
      path.join(bundleDir, "vitpose.status.json"),
      JSON.stringify({ jobId: "j1", status: "running" }),
    );
    const body = await (await GET(makeRequest(BUNDLE_KEY))).json();
    expect(body.vitpose).toBeNull();
    expect(body.error).toBeNull();
    await rm(path.join(bundleDir, "vitpose.status.json"), { force: true });
  });

  it("GET ignores a stale error sidecar once the artifact exists", async () => {
    const { GET } = await importRoute("development");
    await writeFile(path.join(bundleDir, "vitpose.json"), JSON.stringify(validScaffold));
    await writeFile(
      path.join(bundleDir, "vitpose.status.json"),
      JSON.stringify({ jobId: "old", status: "error", error: "stale" }),
    );
    const body = await (await GET(makeRequest(BUNDLE_KEY))).json();
    expect(body.vitpose).toEqual(validScaffold);
    expect(body.error).toBeUndefined();
    await rm(path.join(bundleDir, "vitpose.json"), { force: true });
    await rm(path.join(bundleDir, "vitpose.status.json"), { force: true });
  });

  it("POST clears a stale status sidecar before relaying the job", async () => {
    await writeFile(
      path.join(bundleDir, "vitpose.status.json"),
      JSON.stringify({ jobId: "old", status: "error", error: "stale" }),
    );
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ jobId: "j2" }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await importRoute("development", "http://localhost:9999");

    const res = await POST(makeRequest(BUNDLE_KEY, validRequest));
    expect(res.status).toBe(202);
    expect(await fileExists(path.join(bundleDir, "vitpose.status.json"))).toBe(false);
  });

  it("GET/POST 400 on an unsafe bundle key", async () => {
    const { GET, POST } = await importRoute("development", "http://localhost:9999");
    expect((await GET(makeRequest("../escape"))).status).toBe(400);
    expect((await POST(makeRequest("a/b/c", validRequest))).status).toBe(400);
  });

  it("POST 400s when HARNESS_API_BASE is not configured", async () => {
    const { POST } = await importRoute("development");
    expect((await POST(makeRequest(BUNDLE_KEY, validRequest))).status).toBe(400);
  });

  it("POST 422s when videoPath is missing", async () => {
    const { POST } = await importRoute("development", "http://localhost:9999");
    const res = await POST(makeRequest(BUNDLE_KEY, { climberCrop: {} }));
    expect(res.status).toBe(422);
  });

  it("POST 422s when frames is missing or empty", async () => {
    const { POST } = await importRoute("development", "http://localhost:9999");
    const { frames: _frames, ...noFrames } = validRequest;
    void _frames;
    expect((await POST(makeRequest(BUNDLE_KEY, noFrames))).status).toBe(422);
    expect((await POST(makeRequest(BUNDLE_KEY, { ...noFrames, frames: [] }))).status).toBe(422);
  });

  it("POST relays the Climber selection to the downloader and passes its status through", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ jobId: "j1" }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await importRoute("development", "http://localhost:9999");

    const res = await POST(makeRequest(BUNDLE_KEY, validRequest));
    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:9999/api/vitpose");
    const sent = JSON.parse(init!.body as string);
    expect(sent).toMatchObject({
      video_path: validRequest.videoPath,
      route_folder: "route-x",
      video_key: "vid_1",
      climber_point: validRequest.climberPoint,
      panning: false,
      frames: validRequest.frames,
    });
  });
});
