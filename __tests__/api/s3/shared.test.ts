import { describe, it, expect, vi, afterEach } from "vitest";

// We must mock the @aws-sdk/client-s3 import that shared.ts pulls in at the
// module level so it doesn't try to instantiate a real S3Client during tests.
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {},
}));

// Dynamically import *after* the mock is in place so the singleton is safe.
const { isValidKey, isValidPrefix, awsErrorMessage, S3_PREFIX, getBucket } =
  await import("@/app/api/s3/shared");

// ---------------------------------------------------------------------------
// isValidKey
// ---------------------------------------------------------------------------

describe("isValidKey", () => {
  it("accepts a well-formed key", () => {
    expect(isValidKey(`${S3_PREFIX}/CO/RedRocks/Classic/run-1-attempt.json`)).toBe(true);
  });

  it("rejects keys that don't start with the prefix", () => {
    expect(isValidKey("Other/foo.json")).toBe(false);
  });

  it("rejects keys without .json extension", () => {
    expect(isValidKey(`${S3_PREFIX}/CO/attempt.txt`)).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(isValidKey(`${S3_PREFIX}/../secret.json`)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidKey("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidPrefix
// ---------------------------------------------------------------------------

describe("isValidPrefix", () => {
  it("accepts the bare prefix", () => {
    expect(isValidPrefix(S3_PREFIX)).toBe(true);
  });

  it("accepts a sub-path of the prefix", () => {
    expect(isValidPrefix(`${S3_PREFIX}/Colorado/`)).toBe(true);
  });

  it("accepts an empty string (root listing)", () => {
    expect(isValidPrefix("")).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(isValidPrefix(`${S3_PREFIX}/../../etc`)).toBe(false);
  });

  it("rejects a prefix outside the scope", () => {
    expect(isValidPrefix("Other/folder")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// awsErrorMessage
// ---------------------------------------------------------------------------

describe("awsErrorMessage", () => {
  it("extracts name + message from an Error", () => {
    const err = new Error("Access denied");
    err.name = "AccessDenied";
    expect(awsErrorMessage(err)).toBe("AccessDenied: Access denied");
  });

  it("prefers Code over name when both exist", () => {
    const err = Object.assign(new Error("bad"), { Code: "NoSuchKey" });
    expect(awsErrorMessage(err)).toBe("NoSuchKey: bad");
  });

  it("returns just the message when name is empty", () => {
    const err = new Error("Something went wrong");
    err.name = "";
    expect(awsErrorMessage(err)).toBe("Something went wrong");
  });

  it("stringifies non-Error values", () => {
    expect(awsErrorMessage("boom")).toBe("boom");
    expect(awsErrorMessage(42)).toBe("42");
    expect(awsErrorMessage(null)).toBe("null");
  });
});

// ---------------------------------------------------------------------------
// getBucket
// ---------------------------------------------------------------------------

describe("getBucket", () => {
  const origEnv = process.env.S3_BUCKET_NAME;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.S3_BUCKET_NAME = origEnv;
    } else {
      delete process.env.S3_BUCKET_NAME;
    }
  });

  it("returns the configured bucket name", () => {
    process.env.S3_BUCKET_NAME = "test-bucket";
    // getBucket reads process.env each time it's called
    expect(getBucket()).toBe("test-bucket");
  });

  it("returns null when the env var is unset", () => {
    delete process.env.S3_BUCKET_NAME;
    expect(getBucket()).toBeNull();
  });
});
