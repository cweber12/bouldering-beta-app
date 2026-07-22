import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

let mockGetAuthUserId: Mock;
let mockReadProfileStorage: Mock;
const mockGetUser = vi.fn();

vi.mock("@/utils/firebase/admin", () => ({
  getAdminAuth: () => ({ getUser: mockGetUser }),
}));

vi.mock("@/app/api/s3/shared", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  mockGetAuthUserId = vi.fn();
  mockReadProfileStorage = vi.fn();
  return {
    ...actual,
    getAuthUserId: mockGetAuthUserId,
    readProfileStorage: mockReadProfileStorage,
    profileKey: (userId: string) => `ProfileData/${userId}/profile.json`,
  };
});

const { GET } = await import("@/app/api/profile/[userId]/route");

function makeReq() {
  return new NextRequest("http://localhost/api/profile/u2");
}

function makeParams(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

describe("GET /api/profile/[userId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns firebase displayName when profile object is missing", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    mockReadProfileStorage.mockResolvedValueOnce(null);
    mockGetUser.mockResolvedValueOnce({ displayName: "Target User" });

    const res = await GET(makeReq(), makeParams("u2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "u2", displayName: "Target User" });
  });

  it("falls back to firebase when profile storage throws", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("viewer");
    mockReadProfileStorage.mockRejectedValueOnce(new Error("AccessDenied"));
    mockGetUser.mockResolvedValueOnce({ displayName: "Target User" });

    const res = await GET(makeReq(), makeParams("u2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "u2", displayName: "Target User", degraded: true });
  });
});
