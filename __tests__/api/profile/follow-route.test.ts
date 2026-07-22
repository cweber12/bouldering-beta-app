import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

let mockGetAuthUserId: Mock;
let mockReadProfileStorage: Mock;
let mockWriteProfileStorage: Mock;

vi.mock("@/app/api/s3/shared", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  mockGetAuthUserId = vi.fn();
  mockReadProfileStorage = vi.fn();
  mockWriteProfileStorage = vi.fn();
  return {
    ...actual,
    getAuthUserId: mockGetAuthUserId,
    readProfileStorage: mockReadProfileStorage,
    writeProfileStorage: mockWriteProfileStorage,
    followingKey: (userId: string) => `ProfileData/${userId}/following.json`,
    S3_PREFIX: "RouteData",
  };
});

const { GET, POST } = await import("@/app/api/profile/follow/route");

describe("/api/profile/follow", () => {
  afterEach(() => vi.clearAllMocks());

  it("GET falls back to RouteData key when ProfileData read fails", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("u1");
    mockReadProfileStorage
      .mockRejectedValueOnce(new Error("AccessDenied"))
      .mockResolvedValueOnce({ following: ["u2"] });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ following: ["u2"] });
    expect(mockReadProfileStorage).toHaveBeenNthCalledWith(1, "ProfileData/u1/following.json");
    expect(mockReadProfileStorage).toHaveBeenNthCalledWith(
      2,
      "RouteData/u1/_social/following.json",
    );
  });

  it("POST persists to RouteData key when ProfileData write fails", async () => {
    mockGetAuthUserId.mockResolvedValueOnce("u1");
    mockReadProfileStorage.mockResolvedValueOnce({ following: [] });
    mockWriteProfileStorage
      .mockRejectedValueOnce(new Error("AccessDenied"))
      .mockResolvedValueOnce(undefined);

    const req = new NextRequest("http://localhost/api/profile/follow", {
      method: "POST",
      body: JSON.stringify({ targetUserId: "u2" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, following: ["u2"] });

    expect(mockWriteProfileStorage).toHaveBeenNthCalledWith(1, "ProfileData/u1/following.json", {
      following: ["u2"],
    });
    expect(mockWriteProfileStorage).toHaveBeenNthCalledWith(
      2,
      "RouteData/u1/_social/following.json",
      {
        following: ["u2"],
      },
    );
  });
});
