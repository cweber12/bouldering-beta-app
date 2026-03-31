import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be set up BEFORE dynamic imports
// ---------------------------------------------------------------------------

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {},
  GetObjectCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
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

// Mock createServiceClient to return a fake Supabase client.
const mockDownload = vi.fn();
const mockUpload = vi.fn();
const mockList = vi.fn();

vi.mock("@/utils/supabase/service", () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        download: mockDownload,
        upload: mockUpload,
        list: mockList,
      }),
    },
  }),
}));

// Dynamically import after mocks.
const {
  profileKey,
  followingKey,
  indexKey,
  isValidProfileKey,
  isValidRoutePrefix,
  PROFILE_TEXT_LIMIT,
  readProfileStorage,
  writeProfileStorage,
  listProfileStorage,
  S3_PREFIX,
} = await import("@/app/api/s3/shared");

// ---------------------------------------------------------------------------
// profileKey / followingKey / indexKey
// ---------------------------------------------------------------------------

describe("profileKey", () => {
  it("returns the correct path", () => {
    expect(profileKey("user-123")).toBe("ProfileData/user-123/profile.json");
  });
});

describe("followingKey", () => {
  it("returns the correct path", () => {
    expect(followingKey("user-123")).toBe("ProfileData/user-123/following.json");
  });
});

describe("indexKey", () => {
  it("returns the correct path", () => {
    expect(indexKey("user-123")).toBe("ProfileData/_index/user-123.json");
  });
});

// ---------------------------------------------------------------------------
// isValidProfileKey
// ---------------------------------------------------------------------------

describe("isValidProfileKey", () => {
  const uid = "test-user";

  it("accepts a valid profile key", () => {
    expect(isValidProfileKey("ProfileData/test-user/profile.json", uid)).toBe(true);
  });

  it("rejects keys for a different user", () => {
    expect(isValidProfileKey("ProfileData/other-user/profile.json", uid)).toBe(false);
  });

  it("rejects keys without .json extension", () => {
    expect(isValidProfileKey("ProfileData/test-user/profile.txt", uid)).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(isValidProfileKey("ProfileData/test-user/../other.json", uid)).toBe(false);
  });

  it("rejects keys longer than 1024", () => {
    const long = "a".repeat(1024);
    expect(isValidProfileKey(`ProfileData/test-user/${long}.json`, uid)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidRoutePrefix
// ---------------------------------------------------------------------------

describe("isValidRoutePrefix", () => {
  const uid = "target-user";

  it("accepts the target user's prefix", () => {
    expect(isValidRoutePrefix(`${S3_PREFIX}/target-user`, uid)).toBe(true);
  });

  it("accepts a sub-path", () => {
    expect(isValidRoutePrefix(`${S3_PREFIX}/target-user/CO/RedRocks`, uid)).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(isValidRoutePrefix(`${S3_PREFIX}/target-user/../other`, uid)).toBe(false);
  });

  it("rejects a prefix for a different user", () => {
    expect(isValidRoutePrefix(`${S3_PREFIX}/other-user`, uid)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PROFILE_TEXT_LIMIT
// ---------------------------------------------------------------------------

describe("PROFILE_TEXT_LIMIT", () => {
  it("is 500", () => {
    expect(PROFILE_TEXT_LIMIT).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// readProfileStorage
// ---------------------------------------------------------------------------

describe("readProfileStorage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("parses and returns JSON from Supabase Storage", async () => {
    const payload = { displayName: "Alice", location: "CO" };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    mockDownload.mockResolvedValueOnce({ data: blob, error: null });

    const result = await readProfileStorage<typeof payload>("some/path.json");
    expect(result).toEqual(payload);
    expect(mockDownload).toHaveBeenCalled();
  });

  it("returns null when the file is not found", async () => {
    mockDownload.mockResolvedValueOnce({
      data: null,
      error: { message: "Object not found" },
    });

    const result = await readProfileStorage("missing/path.json");
    expect(result).toBeNull();
  });

  it("throws on non-not-found errors", async () => {
    mockDownload.mockResolvedValueOnce({
      data: null,
      error: { message: "Permission denied" },
    });

    await expect(readProfileStorage("any/path.json")).rejects.toEqual({
      message: "Permission denied",
    });
  });
});

// ---------------------------------------------------------------------------
// writeProfileStorage
// ---------------------------------------------------------------------------

describe("writeProfileStorage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uploads JSON with upsert", async () => {
    mockUpload.mockResolvedValueOnce({ error: null });

    await writeProfileStorage("some/path.json", { foo: "bar" });
    expect(mockUpload).toHaveBeenCalledWith(
      "some/path.json",
      expect.any(Blob),
      { contentType: "application/json", upsert: true },
    );
  });

  it("throws when upload fails", async () => {
    mockUpload.mockResolvedValueOnce({ error: { message: "Quota exceeded" } });

    await expect(writeProfileStorage("path.json", {})).rejects.toEqual({
      message: "Quota exceeded",
    });
  });
});

// ---------------------------------------------------------------------------
// listProfileStorage
// ---------------------------------------------------------------------------

describe("listProfileStorage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns file names from the folder", async () => {
    mockList.mockResolvedValueOnce({
      data: [{ name: "a.json" }, { name: "b.json" }],
      error: null,
    });

    const names = await listProfileStorage("some/folder");
    expect(names).toEqual(["a.json", "b.json"]);
  });

  it("returns empty array when folder is empty", async () => {
    mockList.mockResolvedValueOnce({ data: [], error: null });

    const names = await listProfileStorage("empty/folder");
    expect(names).toEqual([]);
  });

  it("throws on error", async () => {
    mockList.mockResolvedValueOnce({
      data: null,
      error: { message: "Bucket not found" },
    });

    await expect(listProfileStorage("bad/folder")).rejects.toEqual({
      message: "Bucket not found",
    });
  });
});
