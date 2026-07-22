import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks — the route reads through shared.readProfileStorage, so we stub that
// boundary rather than simulating S3 bodies. Auth is stubbed the same way as
// the climbs/detail test.
// ---------------------------------------------------------------------------

let mockGetAuthUserId: Mock;
let mockReadProfileStorage: Mock;

vi.mock("@/utils/firebase/admin", () => ({
  getAdminAuth: () => ({}),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    get: () => undefined,
    set: () => {},
  }),
}));

vi.mock("@/app/api/s3/shared", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  mockGetAuthUserId = vi.fn();
  mockReadProfileStorage = vi.fn();
  return {
    ...actual,
    getAuthUserId: mockGetAuthUserId,
    readProfileStorage: mockReadProfileStorage,
  };
});

const { GET } = await import("@/app/api/profile/[userId]/climbs/attempt/route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(key?: string): NextRequest {
  const url = key
    ? `http://localhost/api/profile/owner-1/climbs/attempt?key=${encodeURIComponent(key)}`
    : `http://localhost/api/profile/owner-1/climbs/attempt`;
  return new NextRequest(url);
}

function makeParams(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

const OWNER_KEY = "RouteData/owner-1/CO/RedRocks/Classic/run-1700000000000-send.json";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/profile/[userId]/climbs/attempt", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUserId.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(OWNER_KEY), makeParams("owner-1"));
    expect(res.status).toBe(401);
    expect(mockReadProfileStorage).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid userId", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    const res = await GET(makeRequest("key"), makeParams("../hack"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when key param is missing", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    const res = await GET(makeRequest(), makeParams("owner-1"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the key belongs to a different owner than the path", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    const res = await GET(
      makeRequest("RouteData/someone-else/CO/Area/Route/run-1-send.json"),
      makeParams("owner-1"),
    );
    expect(res.status).toBe(400);
    expect(mockReadProfileStorage).not.toHaveBeenCalled();
  });

  it("returns 400 for path traversal in the key", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    const res = await GET(makeRequest("RouteData/owner-1/../secret.json"), makeParams("owner-1"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the metadata object does not exist", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    mockReadProfileStorage.mockResolvedValueOnce(null); // metadata read → missing
    const res = await GET(makeRequest(OWNER_KEY), makeParams("owner-1"));
    expect(res.status).toBe(404);
  });

  it("merges the heavy-data sibling into the metadata on success", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    // First call: metadata; second call: .data.json sibling with heavy fields.
    mockReadProfileStorage
      .mockResolvedValueOnce({ schemaVersion: 2, state: "CO", runType: "send" })
      .mockResolvedValueOnce({ frames: [{ t: 0 }], orbFeatures: { descriptors: "base64" } });

    const res = await GET(makeRequest(OWNER_KEY), makeParams("owner-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schemaVersion).toBe(2);
    expect(body.frames).toEqual([{ t: 0 }]);
    expect(body.orbFeatures).toEqual({ descriptors: "base64" });

    // The sibling key is the .data.json variant of the requested key.
    expect(mockReadProfileStorage).toHaveBeenNthCalledWith(1, OWNER_KEY);
    expect(mockReadProfileStorage).toHaveBeenNthCalledWith(
      2,
      OWNER_KEY.replace(/\.json$/, ".data.json"),
    );
  });

  it("returns the object as-is when there is no heavy-data sibling (route photo)", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    const photoKey = "RouteData/owner-1/CO/RedRocks/Classic/route-image.json";
    mockReadProfileStorage
      .mockResolvedValueOnce({ dataUrl: "data:image/jpeg;base64,xyz" }) // photo
      .mockResolvedValueOnce(null); // no sibling
    const res = await GET(makeRequest(photoKey), makeParams("owner-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dataUrl).toBe("data:image/jpeg;base64,xyz");
  });
});
