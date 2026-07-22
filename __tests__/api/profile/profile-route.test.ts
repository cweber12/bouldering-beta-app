import { describe, it, expect, vi, afterEach, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockGetAuthUser: Mock;
let mockReadProfileStorage: Mock;
let mockWriteProfileStorage: Mock;

vi.mock("@/app/api/s3/shared", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  mockGetAuthUser = vi.fn();
  mockReadProfileStorage = vi.fn();
  mockWriteProfileStorage = vi.fn();
  return {
    ...actual,
    getAuthUser: mockGetAuthUser,
    readProfileStorage: mockReadProfileStorage,
    writeProfileStorage: mockWriteProfileStorage,
    profileKey: (userId: string) => `ProfileData/${userId}/profile.json`,
    indexKey: (userId: string) => `ProfileData/_index/${userId}.json`,
  };
});

const { GET } = await import("@/app/api/profile/route");

describe("GET /api/profile", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("backfills index entry even when profile does not exist", async () => {
    mockGetAuthUser.mockResolvedValueOnce({ id: "user-1", email: "cole@example.com" });
    mockReadProfileStorage.mockResolvedValueOnce(null);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-1", email: "cole@example.com" });

    expect(mockWriteProfileStorage).toHaveBeenCalledWith("ProfileData/_index/user-1.json", {
      displayName: "",
      email: "cole@example.com",
      location: "",
    });
  });

  it("returns profile payload and backfills index with profile fields", async () => {
    mockGetAuthUser.mockResolvedValueOnce({ id: "user-2", email: "other@example.com" });
    mockReadProfileStorage.mockResolvedValueOnce({
      displayName: "Cole 2",
      location: "Boulder, CO",
      bio: "climber",
      profilePicture: "",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      displayName: "Cole 2",
      location: "Boulder, CO",
      bio: "climber",
      profilePicture: "",
      userId: "user-2",
      email: "other@example.com",
    });

    expect(mockWriteProfileStorage).toHaveBeenCalledWith("ProfileData/_index/user-2.json", {
      displayName: "Cole 2",
      email: "other@example.com",
      location: "Boulder, CO",
    });
  });
});
