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
  seedTap: { x: 0.5, y: 0.4, t: 2.33 },
  seedRegion: { x: 0.35, y: 0.25, w: 0.3, h: 0.3 },
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

  it("GET surfaces downloader warnings from the status sidecar alongside a scaffold", async () => {
    const { GET } = await importRoute("development");
    await writeFile(path.join(bundleDir, "vitpose.json"), JSON.stringify(validScaffold));
    await writeFile(
      path.join(bundleDir, "vitpose.status.json"),
      JSON.stringify({
        jobId: "j1",
        status: "done",
        warnings: ["climber_point.t is missing; using legacy global tap seeding.", 7, ""],
      }),
    );
    const body = await (await GET(makeRequest(BUNDLE_KEY))).json();
    expect(body.vitpose).toEqual(validScaffold);
    expect(body.warnings).toEqual(["climber_point.t is missing; using legacy global tap seeding."]);
    expect(body.error).toBeUndefined();
    await rm(path.join(bundleDir, "vitpose.json"), { force: true });
    await rm(path.join(bundleDir, "vitpose.status.json"), { force: true });
  });

  it("GET surfaces seedDebug.seedFound alongside a poseless scaffold", async () => {
    const { GET } = await importRoute("development");
    const poseless = { version: 1, frames: [{ timestamp: 0, keypoints: [] }] };
    await writeFile(path.join(bundleDir, "vitpose.json"), JSON.stringify(poseless));
    await writeFile(
      path.join(bundleDir, "vitpose.status.json"),
      JSON.stringify({ jobId: "j1", status: "done", seedDebug: { seedFound: false } }),
    );
    const body = await (await GET(makeRequest(BUNDLE_KEY))).json();
    expect(body.vitpose).toEqual(poseless);
    expect(body.seedFound).toBe(false);
    await rm(path.join(bundleDir, "vitpose.json"), { force: true });
    await rm(path.join(bundleDir, "vitpose.status.json"), { force: true });
  });

  it("GET reads seedFound null when the sidecar or the field is absent", async () => {
    const { GET } = await importRoute("development");
    await writeFile(path.join(bundleDir, "vitpose.json"), JSON.stringify(validScaffold));
    const body = await (await GET(makeRequest(BUNDLE_KEY))).json();
    expect(body.seedFound).toBeNull();
    await rm(path.join(bundleDir, "vitpose.json"), { force: true });
  });

  it("GET returns warnings with a terminal error when no artifact exists", async () => {
    const { GET } = await importRoute("development");
    await writeFile(
      path.join(bundleDir, "vitpose.status.json"),
      JSON.stringify({ jobId: "j1", status: "error", error: "boom", warnings: ["heads up"] }),
    );
    const body = await (await GET(makeRequest(BUNDLE_KEY))).json();
    expect(body.vitpose).toBeNull();
    expect(body.error).toBe("boom");
    expect(body.warnings).toEqual(["heads up"]);
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

  it("POST clears a stale status sidecar AND the previous artifact before relaying the job", async () => {
    await writeFile(
      path.join(bundleDir, "vitpose.status.json"),
      JSON.stringify({ jobId: "old", status: "error", error: "stale" }),
    );
    // The previous calibration's artifact: left in place, the poller would read
    // it instantly and seed truth from the wrong calibration (the export race).
    await writeFile(path.join(bundleDir, "vitpose.json"), JSON.stringify(validScaffold));
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ jobId: "j2" }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await importRoute("development", "http://localhost:9999");

    const res = await POST(makeRequest(BUNDLE_KEY, validRequest));
    expect(res.status).toBe(202);
    expect(await fileExists(path.join(bundleDir, "vitpose.status.json"))).toBe(false);
    expect(await fileExists(path.join(bundleDir, "vitpose.json"))).toBe(false);
  });

  it("GET withholds an artifact stamped under an older calibration than setup.json", async () => {
    const { GET } = await importRoute("development");
    await writeFile(
      path.join(bundleDir, "setup.json"),
      JSON.stringify({ version: 1, setupHash: "current-hash" }),
    );
    await writeFile(
      path.join(bundleDir, "vitpose.json"),
      JSON.stringify({ ...validScaffold, setupHash: "old-hash" }),
    );

    const body = await (await GET(makeRequest(BUNDLE_KEY))).json();
    expect(body.vitpose).toBeNull();
    expect(body.error).toMatch(/older calibration/i);

    await rm(path.join(bundleDir, "setup.json"), { force: true });
    await rm(path.join(bundleDir, "vitpose.json"), { force: true });
  });

  it("GET treats a stale artifact as pending while a fresh job is still running", async () => {
    const { GET } = await importRoute("development");
    await writeFile(
      path.join(bundleDir, "setup.json"),
      JSON.stringify({ version: 1, setupHash: "current-hash" }),
    );
    await writeFile(
      path.join(bundleDir, "vitpose.json"),
      JSON.stringify({ ...validScaffold, setupHash: "old-hash" }),
    );
    await writeFile(
      path.join(bundleDir, "vitpose.status.json"),
      JSON.stringify({ jobId: "j3", status: "running" }),
    );

    const body = await (await GET(makeRequest(BUNDLE_KEY))).json();
    expect(body.vitpose).toBeNull();
    expect(body.error).toBeNull();

    await rm(path.join(bundleDir, "setup.json"), { force: true });
    await rm(path.join(bundleDir, "vitpose.json"), { force: true });
    await rm(path.join(bundleDir, "vitpose.status.json"), { force: true });
  });

  it("GET serves an artifact whose stamped hash matches the current calibration", async () => {
    const { GET } = await importRoute("development");
    await writeFile(
      path.join(bundleDir, "setup.json"),
      JSON.stringify({ version: 1, setupHash: "current-hash" }),
    );
    const freshScaffold = { ...validScaffold, setupHash: "current-hash" };
    await writeFile(path.join(bundleDir, "vitpose.json"), JSON.stringify(freshScaffold));

    const body = await (await GET(makeRequest(BUNDLE_KEY))).json();
    expect(body.vitpose).toEqual(freshScaffold);

    await rm(path.join(bundleDir, "setup.json"), { force: true });
    await rm(path.join(bundleDir, "vitpose.json"), { force: true });
  });

  it("GET trusts a legacy artifact without a stamped hash against any calibration", async () => {
    const { GET } = await importRoute("development");
    await writeFile(
      path.join(bundleDir, "setup.json"),
      JSON.stringify({ version: 1, setupHash: "current-hash" }),
    );
    await writeFile(path.join(bundleDir, "vitpose.json"), JSON.stringify(validScaffold));

    const body = await (await GET(makeRequest(BUNDLE_KEY))).json();
    expect(body.vitpose).toEqual(validScaffold);

    await rm(path.join(bundleDir, "setup.json"), { force: true });
    await rm(path.join(bundleDir, "vitpose.json"), { force: true });
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

  it("POST relays the Seed tap + region to the downloader and passes its status through", async () => {
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
      seed_tap: validRequest.seedTap,
      seed_region: validRequest.seedRegion,
      // `climber_point` is kept as a legacy alias of the Seed tap for a
      // downloader that has not migrated to `seed_tap` yet.
      climber_point: validRequest.seedTap,
      panning: false,
      frames: validRequest.frames,
    });
  });

  // -------------------------------------------------------------------------
  // Climb window relay (harness ADR 0007 §3)
  // -------------------------------------------------------------------------

  it("omits both climb bounds when the Bundle is unmarked", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ jobId: "j1" }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await importRoute("development", "http://localhost:9999");

    await POST(makeRequest(BUNDLE_KEY, validRequest));
    const sent = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    // Omitted, never null: the harness reads a missing bound off setup.json, and
    // an explicit null would override that fallback with nothing.
    expect("climb_start" in sent).toBe(false);
    expect("climb_end" in sent).toBe(false);
  });

  it("relays each climb bound independently", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ jobId: "j1" }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await importRoute("development", "http://localhost:9999");

    await POST(makeRequest(BUNDLE_KEY, { ...validRequest, climbStart: 3.5, climbEnd: 58 }));
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({
      climb_start: 3.5,
      climb_end: 58,
    });

    // An end with no start: the harness fills the start from setup.json.
    await POST(makeRequest(BUNDLE_KEY, { ...validRequest, climbEnd: 58 }));
    const endOnly = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
    expect(endOnly.climb_end).toBe(58);
    expect("climb_start" in endOnly).toBe(false);
  });

  it("422s a window the harness would reject, without submitting a job", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ jobId: "j1" }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await importRoute("development", "http://localhost:9999");

    // end <= start, negative, and non-numeric all fail here rather than costing
    // a submitted job that dies downstream on the endpoint's own 422.
    expect(
      (await POST(makeRequest(BUNDLE_KEY, { ...validRequest, climbStart: 40, climbEnd: 30 })))
        .status,
    ).toBe(422);
    expect(
      (await POST(makeRequest(BUNDLE_KEY, { ...validRequest, climbEnd: -1 }))).status,
    ).toBe(422);
    expect(
      (await POST(makeRequest(BUNDLE_KEY, { ...validRequest, climbStart: "3.5" }))).status,
    ).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the existing artifact intact when the window is rejected", async () => {
    // Validation runs before the clear-the-previous-run step, so a bad window
    // costs a 422 and nothing else — it must never delete a good scaffold.
    await writeFile(path.join(bundleDir, "vitpose.json"), JSON.stringify(validScaffold));
    vi.stubGlobal("fetch", vi.fn());
    const { POST } = await importRoute("development", "http://localhost:9999");

    const res = await POST(
      makeRequest(BUNDLE_KEY, { ...validRequest, climbStart: 40, climbEnd: 30 }),
    );
    expect(res.status).toBe(422);
    expect(await fileExists(path.join(bundleDir, "vitpose.json"))).toBe(true);
    await rm(path.join(bundleDir, "vitpose.json"), { force: true });
  });
});
