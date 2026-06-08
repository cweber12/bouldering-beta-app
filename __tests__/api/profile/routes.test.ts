import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockGetAuthUserId: Mock;
let mockGetBucket: Mock;
let mockS3Send: Mock;

interface MockCmd {
  _type: "list" | "get";
  Key?: string;
}

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {
    send = (...args: unknown[]) => mockS3Send(...args);
  },
  ListObjectsV2Command: class MockListCommand {
    constructor(opts: unknown) {
      Object.assign(this, { _type: "list" }, Object(opts));
    }
  },
  GetObjectCommand: class MockGetCommand {
    constructor(opts: unknown) {
      Object.assign(this, { _type: "get" }, Object(opts));
    }
  },
}));

vi.mock("@/utils/firebase/admin", () => ({ getAdminAuth: () => ({}) }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => {} }),
}));

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

const { GET } = await import("@/app/api/profile/[userId]/routes/route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/profile/user-1/routes${query}`);
}

function makeParams(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

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

describe("GET /api/profile/[userId]/routes", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUserId.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), makeParams("user-1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid userId", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    const res = await GET(makeRequest(), makeParams("../hack"));
    expect(res.status).toBe(400);
  });

  it("folds runs by route, picking the most recent run as the head", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    mockGetBucket.mockReturnValueOnce("test-bucket");

    const keys = [
      "RouteData/user-1/CO/Area1/RouteA/run-100-attempt.json",
      "RouteData/user-1/CO/Area1/RouteA/run-200-send.json",
      "RouteData/user-1/CO/Area1/RouteB/run-150-attempt.json",
    ];
    const headData: Record<string, unknown> = {
      "RouteData/user-1/CO/Area1/RouteA/run-200-send.json": {
        thumbnail: "tA",
        rating: "V5",
        coordinates: { lat: 1, lng: 2 },
      },
      "RouteData/user-1/CO/Area1/RouteB/run-150-attempt.json": { thumbnail: "tB" },
    };

    mockS3Send.mockImplementation(async (cmd: MockCmd) => {
      if (cmd._type === "list") {
        return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
      }
      return { Body: makeBody(JSON.stringify(headData[cmd.Key!] ?? {})) };
    });

    const res = await GET(makeRequest(), makeParams("user-1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(2);
    // Default sort = recent → RouteA (ts 200) before RouteB (ts 150).
    const [a, b] = body.items;
    expect(a.route).toBe("RouteA");
    expect(a.climbCount).toBe(2);
    expect(a.lastClimbKey).toBe("RouteData/user-1/CO/Area1/RouteA/run-200-send.json");
    expect(a.rating).toBe("V5");
    expect(a.thumbnail).toBe("tA");
    expect(a.hasGps).toBe(true);
    expect(a.coordinates).toEqual({ lat: 1, lng: 2 });

    expect(b.route).toBe("RouteB");
    expect(b.climbCount).toBe(1);
    expect(b.hasGps).toBe(false);
    expect(b.coordinates).toBeUndefined();
  });

  it("filters by search across state/area/route", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    mockGetBucket.mockReturnValueOnce("test-bucket");

    const keys = [
      "RouteData/user-1/CO/Flagstaff/Midnight/run-100-send.json",
      "RouteData/user-1/CO/Eldorado/Naked/run-200-attempt.json",
    ];
    mockS3Send.mockImplementation(async (cmd: MockCmd) => {
      if (cmd._type === "list") {
        return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
      }
      return { Body: makeBody("{}") };
    });

    const res = await GET(makeRequest("?search=flagstaff"), makeParams("user-1"));
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].area).toBe("Flagstaff");
  });
});
