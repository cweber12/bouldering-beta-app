import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockGetAuthUserId: Mock;
let mockListProfileStorage: Mock;
let mockReadProfileStorage: Mock;

vi.mock("@/app/api/s3/shared", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  mockGetAuthUserId = vi.fn();
  mockListProfileStorage = vi.fn();
  mockReadProfileStorage = vi.fn();
  return {
    ...actual,
    getAuthUserId: mockGetAuthUserId,
    listProfileStorage: mockListProfileStorage,
    readProfileStorage: mockReadProfileStorage,
  };
});

const { GET } = await import("@/app/api/profile/search/route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/profile/search${query}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/profile/search", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUserId.mockResolvedValueOnce(null);
    const res = await GET(makeRequest("?q=alice"));
    expect(res.status).toBe(401);
  });

  it("finds a known account by userId", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    mockListProfileStorage.mockResolvedValueOnce(["climber-1.json", "other.json"]);
    mockReadProfileStorage.mockImplementation(async (key: string) => {
      if (key.endsWith("climber-1.json")) {
        return { displayName: "Someone Else", email: "climber@example.com" };
      }
      if (key.endsWith("other.json")) {
        return { displayName: "Another Person", email: "another@example.com" };
      }
      return null;
    });

    const res = await GET(makeRequest("?q=climber-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results?: Array<{ userId: string }> };
    expect(body.results?.map((result) => result.userId)).toEqual(["climber-1"]);
  });

  it("finds a known account by display name", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    mockListProfileStorage.mockResolvedValueOnce(["climber-1.json"]);
    mockReadProfileStorage.mockResolvedValueOnce({
      displayName: "Alice",
      email: "alice@example.com",
    });

    const res = await GET(makeRequest("?q=alice"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results?: Array<{ userId: string; displayName?: string; email?: string }>;
    };
    expect(body.results).toEqual([
      { userId: "climber-1", displayName: "Alice", email: "alice@example.com" },
    ]);
  });
});