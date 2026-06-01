import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { uid: "user-123" } }),
}));

import { useS3Storage } from "@/hooks/useS3Storage";
import type { RouteAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAttempt(overrides?: Partial<RouteAttempt>): RouteAttempt {
  return {
    id: "run-1700000000000",
    videoMeta: { name: "v.mp4", width: 640, height: 480, fps: 30, duration: 10 },
    frames: [],
    orbFeatures: null,
    matchesPerFrame: null,
    state: "Colorado",
    area: "Red Rocks",
    route: "The Classic",
    runType: "attempt",
    frameCaptures: null,
    ...overrides,
  } as RouteAttempt;
}

/** A `fetch` Response stub. */
function res(ok: boolean, json: unknown) {
  return { ok, json: async () => json } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// uploadAttempt — write order (issue 01: data-first, metadata-last)
// ---------------------------------------------------------------------------

describe("useS3Storage.uploadAttempt write order", () => {
  it("writes the heavy .data.json sibling before the metadata marker", async () => {
    const putKeys: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as { key: string };
      putKeys.push(body.key);
      return res(true, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useS3Storage());
    let key = "";
    await act(async () => {
      key = await result.current.uploadAttempt(makeAttempt());
    });

    expect(putKeys).toHaveLength(2);
    expect(putKeys[0]).toMatch(/\.data\.json$/);          // heavy data first
    expect(putKeys[1]).toBe(key);                          // metadata marker last
    expect(putKeys[1].endsWith(".data.json")).toBe(false);
  });

  it("never writes the metadata marker when the heavy-data write fails (fail-closed)", async () => {
    const putKeys: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as { key: string };
      putKeys.push(body.key);
      // First write (the .data.json sibling) fails.
      return res(false, { error: "S3 down" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useS3Storage());
    await act(async () => {
      await expect(result.current.uploadAttempt(makeAttempt())).rejects.toThrow("S3 down");
    });

    // Only the failed data write was attempted; the marker was never written.
    expect(putKeys).toHaveLength(1);
    expect(putKeys[0]).toMatch(/\.data\.json$/);
  });
});

// ---------------------------------------------------------------------------
// downloadAttempt — load guard (issue 01: throw on missing heavy data)
// ---------------------------------------------------------------------------

describe("useS3Storage.downloadAttempt load guard", () => {
  it("throws when a split run's .data.json sibling is missing", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      // Metadata object exists (split format — schemaVersion present, no frames).
      if (!url.includes(".data.json")) {
        return res(true, { id: "run-1", schemaVersion: 2, route: "The Classic" });
      }
      // Heavy-data sibling is missing.
      return res(false, { error: "NoSuchKey" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useS3Storage());
    await act(async () => {
      await expect(
        result.current.downloadAttempt("RouteData/user-123/CO/RR/TC/run-1-attempt.json"),
      ).rejects.toThrow(/frame data could not be loaded/i);
    });
  });

  it("merges metadata and data for a healthy split run", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes(".data.json")) {
        return res(true, { id: "run-1", schemaVersion: 2, route: "The Classic" });
      }
      return res(true, { frames: [], orbFeatures: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useS3Storage());
    let attempt: RouteAttempt | undefined;
    await act(async () => {
      attempt = await result.current.downloadAttempt(
        "RouteData/user-123/CO/RR/TC/run-1-attempt.json",
      );
    });
    expect(attempt!.id).toBe("run-1");
    expect(attempt!.route).toBe("The Classic");
  });

  it("loads a legacy combined object without fetching a data sibling", async () => {
    const fetchMock = vi.fn(async () =>
      res(true, { id: "legacy-1", frames: [], orbFeatures: null, route: "Old Route" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useS3Storage());
    let attempt: RouteAttempt | undefined;
    await act(async () => {
      attempt = await result.current.downloadAttempt(
        "RouteData/user-123/CO/RR/OR/attempt-1.json",
      );
    });
    expect(attempt!.id).toBe("legacy-1");
    // Only the metadata key was fetched (legacy has inline frames → not split).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
