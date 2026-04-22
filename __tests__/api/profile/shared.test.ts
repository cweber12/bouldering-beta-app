import { describe, it, expect, vi } from "vitest";

// We must mock the @aws-sdk/client-s3 import that shared.ts pulls in at the
// module level so it doesn't try to instantiate a real S3Client during tests.
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {},
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

const {
  PROFILE_PREFIX,
  profileKey,
  followingKey,
  indexKey,
  isValidProfileKey,
  isValidRoutePrefix,
  PROFILE_TEXT_LIMIT,
  S3_PREFIX,
} = await import("@/app/api/s3/shared");

// ---------------------------------------------------------------------------
// profileKey / followingKey / indexKey
// ---------------------------------------------------------------------------

describe("profileKey", () => {
  it("produces the expected S3 key", () => {
    expect(profileKey("u1")).toBe(`${PROFILE_PREFIX}/u1/profile.json`);
  });
});

describe("followingKey", () => {
  it("produces the expected S3 key", () => {
    expect(followingKey("u1")).toBe(`${PROFILE_PREFIX}/u1/following.json`);
  });
});

describe("indexKey", () => {
  it("produces the expected S3 key", () => {
    expect(indexKey("u1")).toBe(`${PROFILE_PREFIX}/_index/u1.json`);
  });
});

// ---------------------------------------------------------------------------
// isValidProfileKey
// ---------------------------------------------------------------------------

describe("isValidProfileKey", () => {
  const uid = "test-user";

  it("accepts a well-formed profile key", () => {
    expect(isValidProfileKey(`${PROFILE_PREFIX}/${uid}/profile.json`, uid)).toBe(true);
  });

  it("rejects keys outside the profile prefix", () => {
    expect(isValidProfileKey(`${S3_PREFIX}/${uid}/profile.json`, uid)).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(isValidProfileKey(`${PROFILE_PREFIX}/${uid}/../secret.json`, uid)).toBe(false);
  });

  it("rejects keys for a different user", () => {
    expect(isValidProfileKey(`${PROFILE_PREFIX}/other-user/profile.json`, uid)).toBe(false);
  });

  it("rejects non-JSON extensions", () => {
    expect(isValidProfileKey(`${PROFILE_PREFIX}/${uid}/profile.txt`, uid)).toBe(false);
  });

  it("rejects overly long keys", () => {
    const long = "a".repeat(1024);
    expect(isValidProfileKey(`${PROFILE_PREFIX}/${uid}/${long}.json`, uid)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidRoutePrefix
// ---------------------------------------------------------------------------

describe("isValidRoutePrefix", () => {
  const target = "target-user";

  it("accepts the target user's route prefix", () => {
    expect(isValidRoutePrefix(`${S3_PREFIX}/${target}`, target)).toBe(true);
  });

  it("accepts a sub-path of the target user prefix", () => {
    expect(isValidRoutePrefix(`${S3_PREFIX}/${target}/Colorado/`, target)).toBe(true);
  });

  it("rejects paths scoped to a different user", () => {
    expect(isValidRoutePrefix(`${S3_PREFIX}/other-user`, target)).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(isValidRoutePrefix(`${S3_PREFIX}/${target}/../../etc`, target)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PROFILE_TEXT_LIMIT
// ---------------------------------------------------------------------------

describe("PROFILE_TEXT_LIMIT", () => {
  it("is a sensible limit", () => {
    expect(PROFILE_TEXT_LIMIT).toBe(500);
  });
});
