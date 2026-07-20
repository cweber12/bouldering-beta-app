import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";

let root: string;
let bundleDir: string;
const BUNDLE_KEY = "route-x/vid_1";

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "harness-videostats-"));
  bundleDir = path.join(root, "route-x", "vid_1");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(path.join(bundleDir, "metadata.json"), JSON.stringify({ source_title: "X" }));
});

afterAll(async () => {
  delete process.env.HARNESS_ANALYSIS_ROOT;
  delete process.env.HARNESS_API_BASE;
  await rm(root, { recursive: true, force: true });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete process.env.HARNESS_API_BASE;
  await rm(path.join(bundleDir, "video-stats.json"), { force: true });
});

async function importRoute(nodeEnv: string, apiBase?: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  process.env.HARNESS_ANALYSIS_ROOT = root;
  if (apiBase) process.env.HARNESS_API_BASE = apiBase;
  return import("@/app/api/dev/corpus/video-stats/route");
}

function makeRequest(key: string, body?: unknown): NextRequest {
  return {
    nextUrl: new URL(
      `http://localhost/api/dev/corpus/video-stats?key=${encodeURIComponent(key)}`,
    ),
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as NextRequest;
}

describe("dev GET/POST /api/dev/corpus/video-stats", () => {
  it("404s outside development for both verbs", async () => {
    const { GET, POST } = await importRoute("production");
    expect((await GET(makeRequest(BUNDLE_KEY))).status).toBe(404);
    expect((await POST(makeRequest(BUNDLE_KEY, {}))).status).toBe(404);
  });

  it("400s on an unsafe bundle key and a missing API base", async () => {
    const { GET, POST } = await importRoute("development");
    expect((await GET(makeRequest("../escape"))).status).toBe(400);
    expect((await POST(makeRequest("../escape", {}))).status).toBe(400);
    // Valid key, but no HARNESS_API_BASE configured.
    expect((await POST(makeRequest(BUNDLE_KEY, {}))).status).toBe(400);
  });

  it("GET reads the artifact back, null when not computed yet", async () => {
    const { GET } = await importRoute("development");
    expect((await (await GET(makeRequest(BUNDLE_KEY))).json()).videoStats).toBeNull();

    await writeFile(
      path.join(bundleDir, "video-stats.json"),
      JSON.stringify({ setupHash: "abc", cameraAngle: { estimate: "level" } }),
    );
    const body = await (await GET(makeRequest(BUNDLE_KEY))).json();
    expect(body.videoStats.cameraAngle.estimate).toBe("level");
  });

  it("POST relays the identifiers snake_case and passes the response through", async () => {
    const { POST } = await importRoute("development", "http://harness.test");

    let relayed: { url: string; body: Record<string, unknown> } | null = null;
    vi.stubGlobal(
      "fetch",
      async (url: string | URL, init?: RequestInit) => {
        relayed = { url: String(url), body: JSON.parse(String(init?.body)) };
        return new Response(
          JSON.stringify({ setupHash: "abc", suggestions: { shadows: "patchy" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    const res = await POST(makeRequest(BUNDLE_KEY, { setupHash: "abc" }));
    expect(res.status).toBe(200);
    expect((await res.json()).suggestions).toEqual({ shadows: "patchy" });
    expect(relayed!.url).toBe("http://harness.test/api/video-stats");
    expect(relayed!.body).toEqual({
      route_folder: "route-x",
      video_key: "vid_1",
      setup_hash: "abc",
    });
  });

  it("POST accepts a missing body (minimal identifier-only call)", async () => {
    const { POST } = await importRoute("development", "http://harness.test");
    let relayedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", async (_url: string | URL, init?: RequestInit) => {
      relayedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ suggestions: {} }), { status: 200 });
    });

    expect((await POST(makeRequest(BUNDLE_KEY))).status).toBe(200);
    expect(relayedBody).toEqual({ route_folder: "route-x", video_key: "vid_1" });
  });

  it("502s when the harness is unreachable", async () => {
    const { POST } = await importRoute("development", "http://harness.test");
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    expect((await POST(makeRequest(BUNDLE_KEY, {}))).status).toBe(502);
  });
});
