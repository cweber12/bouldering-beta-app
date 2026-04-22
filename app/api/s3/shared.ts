import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { cookies } from "next/headers";
import { getAdminAuth } from "@/utils/firebase/admin";
import { SESSION_COOKIE_NAME } from "@/utils/firebase/constants";
import type { Readable } from "stream";

/** The S3 key prefix scoping all RouteData objects. */
export const S3_PREFIX = process.env.S3_KEY_PREFIX ?? "RouteData";

/** The S3 key prefix scoping all profile objects. */
export const PROFILE_PREFIX = "ProfileData";

/** Singleton S3 client — reuses the HTTP connection pool across requests. */
export const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });

/** Resolve the bucket name from the environment, or `null` when unconfigured. */
export function getBucket(): string | null {
  return process.env.S3_BUCKET_NAME ?? null;
}

// ---------------------------------------------------------------------------
// Internal helper — verify the Firebase session cookie from request cookies
// ---------------------------------------------------------------------------

async function verifySession(): Promise<{ uid: string; email: string } | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;
  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    return { uid: decoded.uid, email: decoded.email ?? "" };
  } catch {
    return null;
  }
}

/**
 * Authenticate the current request via the Firebase session cookie.
 * Returns the Firebase UID string, or `null` when unauthenticated.
 */
export async function getAuthUserId(): Promise<string | null> {
  const session = await verifySession();
  return session?.uid ?? null;
}

/**
 * Authenticate the current request via the Firebase session cookie.
 * Returns `{ id, email }` or `null` when unauthenticated.
 */
export async function getAuthUser(): Promise<{ id: string; email: string } | null> {
  const session = await verifySession();
  if (!session) return null;
  return { id: session.uid, email: session.email };
}

/**
 * Validate an S3 object key.
 *
 * Keys must:
 *  - end with `.json`
 *  - not contain `..`
 *  - start with the expected prefix
 *  - contain the authenticated user's ID as the first path segment after the prefix
 */
export function isValidKey(key: string, userId: string): boolean {
  return (
    key.length <= 1024 &&
    key.endsWith(".json") &&
    !key.includes("..") &&
    key.startsWith(`${S3_PREFIX}/${userId}/`)
  );
}

/**
 * Validate an S3 prefix (for listing).
 *
 * Ensures the prefix is scoped to the authenticated user's data.
 */
export function isValidPrefix(prefix: string, userId: string): boolean {
  return (
    !prefix.includes("..") &&
    (prefix === `${S3_PREFIX}/${userId}` || prefix.startsWith(`${S3_PREFIX}/${userId}/`))
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
    const detail = label ? `${label}: ${err.message}` : err.message;
    // In production, hide AWS-internal messages from the client.
    if (process.env.NODE_ENV === "production") {
      console.error("[S3]", detail);
      return "An internal storage error occurred.";
    }
    return detail;
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

/** S3 key for a user's profile JSON. */
export function profileKey(userId: string): string {
  return `${PROFILE_PREFIX}/${userId}/profile.json`;
}

/** S3 key for a user's following list. */
export function followingKey(userId: string): string {
  return `${PROFILE_PREFIX}/${userId}/following.json`;
}

/** S3 key for a user's search-index entry. */
export function indexKey(userId: string): string {
  return `${PROFILE_PREFIX}/_index/${userId}.json`;
}

/** Validate a profile-scoped S3 key (must be under ProfileData/{userId}/). */
export function isValidProfileKey(key: string, userId: string): boolean {
  return (
    key.length <= 1024 &&
    key.endsWith(".json") &&
    !key.includes("..") &&
    key.startsWith(`${PROFILE_PREFIX}/${userId}/`)
  );
}

/** Validate a prefix for listing a user's route data (any authenticated user may list). */
export function isValidRoutePrefix(prefix: string, targetUserId: string): boolean {
  return (
    !prefix.includes("..") &&
    (prefix === `${S3_PREFIX}/${targetUserId}` || prefix.startsWith(`${S3_PREFIX}/${targetUserId}/`))
  );
}

/** Maximum allowed length for user-supplied profile text fields. */
export const PROFILE_TEXT_LIMIT = 500;

// ---------------------------------------------------------------------------
// Profile storage helpers — profile data lives in the same S3 bucket as
// route data, under the ProfileData/ prefix.
// ---------------------------------------------------------------------------

/**
 * Read a JSON object from S3 at the given key.
 * Returns `null` when the object does not exist (NoSuchKey).
 */
export async function readProfileStorage<T>(key: string): Promise<T | null> {
  const bucket = getBucket();
  if (!bucket) throw new Error("S3_BUCKET_NAME is not configured.");

  try {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const res = await s3.send(cmd);

    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as Readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    return JSON.parse(text) as T;
  } catch (err) {
    const name = err instanceof Error ? (err as Error & { name?: string; Code?: string }).name ?? "" : "";
    const code = err instanceof Error ? (err as Error & { Code?: string }).Code ?? "" : "";
    if (name === "NoSuchKey" || code === "NoSuchKey") return null;
    throw err;
  }
}

/**
 * Write a JSON object to S3 at the given key (upsert).
 */
export async function writeProfileStorage(key: string, body: unknown): Promise<void> {
  const bucket = getBucket();
  if (!bucket) throw new Error("S3_BUCKET_NAME is not configured.");

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(body),
    ContentType: "application/json",
  });
  await s3.send(cmd);
}

/**
 * List JSON file names (not full keys) under a given S3 prefix/folder.
 * Returns bare file names (last path segment), e.g. `["u1.json", "u2.json"]`.
 */
export async function listProfileStorage(folder: string): Promise<string[]> {
  const bucket = getBucket();
  if (!bucket) throw new Error("S3_BUCKET_NAME is not configured.");

  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  const objects: string[] = [];
  let token: string | undefined;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token,
    });
    const res = await s3.send(cmd);
    for (const obj of res.Contents ?? []) {
      if (obj.Key) {
        // Return only the final segment (file name), e.g. "u1.json"
        const name = obj.Key.slice(prefix.length);
        if (name && !name.includes("/")) objects.push(name);
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  return objects;
}
