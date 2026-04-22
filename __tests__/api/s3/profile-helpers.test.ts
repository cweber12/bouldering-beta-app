import { describe, it, expect, vi, afterEach, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be set up BEFORE dynamic imports
// ---------------------------------------------------------------------------

let mockS3Send: Mock;

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {
    send = (...args: unknown[]) => mockS3Send(...args);
  },
  GetObjectCommand: vi.fn(function(this: unknown, opts: unknown) {
    Object.assign(this as object, { _type: "GetObjectCommand" }, Object(opts));
  }),
  PutObjectCommand: vi.fn(function(this: unknown, opts: unknown) {
    Object.assign(this as object, { _type: "PutObjectCommand" }, Object(opts));
  }),
  ListObjectsV2Command: vi.fn(function(this: unknown, opts: unknown) {
    Object.assign(this as object, { _type: "ListObjectsV2Command" }, Object(opts));
  }),
}));

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

// Set S3_BUCKET_NAME so getBucket() returns a non-null value.
vi.stubEnv("S3_BUCKET_NAME", "test-bucket");

// Initialise the send mock before module import.
mockS3Send = vi.fn();

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

  it("parses and returns JSON from S3", async () => {
    const payload = { displayName: "Alice", location: "CO" };
    const body = {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify(payload));
      },
    };
    mockS3Send.mockResolvedValueOnce({ Body: body });

    const result = await readProfileStorage<typeof payload>("ProfileData/user/profile.json");
    expect(result).toEqual(payload);
    expect(mockS3Send).toHaveBeenCalledOnce();
  });

  it("returns null when the key does not exist (NoSuchKey)", async () => {
    const err = new Error("NoSuchKey");
    err.name = "NoSuchKey";
    mockS3Send.mockRejectedValueOnce(err);

    const result = await readProfileStorage("ProfileData/user/missing.json");
    expect(result).toBeNull();
  });

  it("throws on non-NoSuchKey S3 errors", async () => {
    const err = new Error("Permission denied");
    err.name = "AccessDenied";
    mockS3Send.mockRejectedValueOnce(err);

    await expect(readProfileStorage("ProfileData/user/profile.json")).rejects.toThrow(
      "Permission denied",
    );
  });
});

// ---------------------------------------------------------------------------
// writeProfileStorage
// ---------------------------------------------------------------------------

describe("writeProfileStorage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends a PutObjectCommand with JSON body", async () => {
    mockS3Send.mockResolvedValueOnce({});

    await writeProfileStorage("ProfileData/user/profile.json", { foo: "bar" });
    expect(mockS3Send).toHaveBeenCalledOnce();
    const cmd = mockS3Send.mock.calls[0][0] as Record<string, unknown>;
    expect(cmd._type).toBe("PutObjectCommand");
    expect(cmd.Body).toBe(JSON.stringify({ foo: "bar" }));
    expect(cmd.ContentType).toBe("application/json");
  });

  it("propagates S3 errors", async () => {
    const err = new Error("Quota exceeded");
    mockS3Send.mockRejectedValueOnce(err);

    await expect(writeProfileStorage("ProfileData/user/profile.json", {})).rejects.toThrow(
      "Quota exceeded",
    );
  });
});

// ---------------------------------------------------------------------------
// listProfileStorage
// ---------------------------------------------------------------------------

describe("listProfileStorage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns file names under the folder", async () => {
    mockS3Send.mockResolvedValueOnce({
      Contents: [
        { Key: "ProfileData/_index/a.json" },
        { Key: "ProfileData/_index/b.json" },
      ],
      IsTruncated: false,
    });

    const names = await listProfileStorage("ProfileData/_index");
    expect(names).toEqual(["a.json", "b.json"]);
  });

  it("returns empty array when folder is empty", async () => {
    mockS3Send.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

    const names = await listProfileStorage("ProfileData/_index");
    expect(names).toEqual([]);
  });

  it("handles pagination via continuation token", async () => {
    mockS3Send
      .mockResolvedValueOnce({
        Contents: [{ Key: "ProfileData/_index/a.json" }],
        IsTruncated: true,
        NextContinuationToken: "token-123",
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: "ProfileData/_index/b.json" }],
        IsTruncated: false,
      });

    const names = await listProfileStorage("ProfileData/_index");
    expect(names).toEqual(["a.json", "b.json"]);
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it("propagates S3 errors", async () => {
    const err = new Error("Bucket not found");
    mockS3Send.mockRejectedValueOnce(err);

    await expect(listProfileStorage("ProfileData/_index")).rejects.toThrow("Bucket not found");
  });
});

