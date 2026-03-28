import { S3Client } from "@aws-sdk/client-s3";

/** The S3 key prefix scoping all RouteData objects. */
export const S3_PREFIX = process.env.S3_KEY_PREFIX ?? "RouteData";

/** Singleton S3 client — reuses the HTTP connection pool across requests. */
export const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });

/** Resolve the bucket name from the environment, or `null` when unconfigured. */
export function getBucket(): string | null {
  return process.env.S3_BUCKET_NAME ?? null;
}

/** Validate an S3 object key is within the allowed prefix and ends with `.json`. */
export function isValidKey(key: string): boolean {
  return (
    key.endsWith(".json") &&
    !key.includes("..") &&
    key.startsWith(S3_PREFIX + "/")
  );
}

/** Validate an S3 prefix (for listing). Rejects path traversal. */
export function isValidPrefix(prefix: string): boolean {
  return (
    !prefix.includes("..") &&
    (prefix === "" || prefix.startsWith(S3_PREFIX + "/") || prefix === S3_PREFIX)
  );
}

/**
 * Extract a human-readable error message from an AWS SDK exception.
 * Falls back to a generic message when the shape is unrecognisable.
 */
export function awsErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const name = (err as Error & { name?: string }).name ?? "";
    const code = (err as Error & { Code?: string }).Code ?? "";
    const label = code || name;
    return label ? `${label}: ${err.message}` : err.message;
  }
  return String(err);
}
