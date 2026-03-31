import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockGetAuthUserId: Mock;
let mockGetBucket: Mock;
let mockS3Send: Mock;

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {
    send = (...args: unknown[]) => mockS3Send(...args);
  },
  GetObjectCommand: class MockGetObjectCommand {
    constructor(opts: unknown) {
      Object.assign(this, { _type: "GetObjectCommand" }, Object(opts));
    }
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({}),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

vi.mock("@/utils/supabase/service", () => ({
  createServiceClient: () => ({
    storage: { from: () => ({ download: vi.fn(), upload: vi.fn(), list: vi.fn() }) },
  }),
}));

// We need to mock getAuthUserId and getBucket from shared.
vi.mock("@/app/api/s3/shared", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  mockGetAuthUserId = vi.fn();
  mockGetBucket = vi.fn();
  mockS3Send = vi.fn();
  return {
    ...actual,
    getAuthUserId: mockGetAuthUserId,
    getBucket: mockGetBucket,
    s3: { send: mockS3Send },
  };
});

const { GET } = await import("@/app/api/profile/[userId]/climbs/detail/route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(key?: string): NextRequest {
  const url = key
    ? `http://localhost/api/profile/user-1/climbs/detail?key=${encodeURIComponent(key)}`
    : `http://localhost/api/profile/user-1/climbs/detail`;
  return new NextRequest(url);
}

function makeParams(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

/** Create a simulated readable body that yields the given text. */
function makeBody(text: string) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(text);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/profile/[userId]/climbs/detail", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUserId.mockResolvedValueOnce(null);
    const res = await GET(makeRequest("RouteData/user-1/CO/Area/Route/run-123-attempt.json"), makeParams("user-1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid userId", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    const res = await GET(makeRequest("key"), makeParams("../hack"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when key param is missing", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    const res = await GET(makeRequest(), makeParams("user-1"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when key does not belong to the user", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    const res = await GET(
      makeRequest("RouteData/other-user/CO/Area/Route/run-123-attempt.json"),
      makeParams("user-1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for path traversal in key", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    const res = await GET(
      makeRequest("RouteData/user-1/../secret.json"),
      makeParams("user-1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when bucket is not configured", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    mockGetBucket.mockReturnValueOnce(null);
    const res = await GET(
      makeRequest("RouteData/user-1/CO/Area/Route/run-123-attempt.json"),
      makeParams("user-1"),
    );
    expect(res.status).toBe(500);
  });

  it("returns climb detail on success", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    mockGetBucket.mockReturnValueOnce("test-bucket");

    const climbData = {
      rating: "V4",
      notes: "Great climb!",
      thumbnail: "data:image/png;base64,abc",
      coordinates: { lat: 40.0, lng: -105.0 },
    };

    mockS3Send.mockResolvedValueOnce({
      Body: makeBody(JSON.stringify(climbData)),
    });

    const res = await GET(
      makeRequest("RouteData/user-1/CO/RedRocks/Classic/run-1700000000000-send.json"),
      makeParams("user-1"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe("RouteData/user-1/CO/RedRocks/Classic/run-1700000000000-send.json");
    expect(body.state).toBe("CO");
    expect(body.area).toBe("RedRocks");
    expect(body.route).toBe("Classic");
    expect(body.runType).toBe("send");
    expect(body.rating).toBe("V4");
    expect(body.notes).toBe("Great climb!");
    expect(body.thumbnail).toBe("data:image/png;base64,abc");
    expect(body.coordinates).toEqual({ lat: 40.0, lng: -105.0 });
  });
});
