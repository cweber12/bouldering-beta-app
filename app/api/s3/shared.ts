import { S3Client } from "@aws-sdk/client-s3";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createServiceClient } from "@/utils/supabase/service";

/** The S3 key prefix scoping all RouteData objects. */
export const S3_PREFIX = process.env.S3_KEY_PREFIX ?? "RouteData";

/** The S3 key prefix scoping all profile objects. */
export const PROFILE_PREFIX = "ProfileData";

/** Supabase Storage bucket for profile data. */
const PROFILE_BUCKET = "user_data";

/** Singleton S3 client — reuses the HTTP connection pool across requests. */
export const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });

/** Resolve the bucket name from the environment, or `null` when unconfigured. */
export function getBucket(): string | null {
  return process.env.S3_BUCKET_NAME ?? null;
}

/**
 * Authenticate the current request via Supabase cookies.
 * Returns the user ID string, or `null` when unauthenticated.
 */
export async function getAuthUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch { /* read-only in some contexts */ }
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Authenticate the current request via Supabase cookies.
 * Returns `{ id, email }` or `null` when unauthenticated.
 */
export async function getAuthUser(): Promise<{ id: string; email: string } | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch { /* read-only in some contexts */ }
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? "" };
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
// Supabase Storage helpers (profile data in `user_data` bucket)
// ---------------------------------------------------------------------------

/**
 * Read a JSON file from Supabase Storage `user_data` bucket.
 * Returns `null` when the file does not exist.
 */
export async function readProfileStorage<T>(path: string): Promise<T | null> {
  const sb = createServiceClient();
  const { data, error } = await sb.storage.from(PROFILE_BUCKET).download(path);
  if (error) {
    // "Object not found" is the Supabase Storage equivalent of NoSuchKey.
    if (error.message?.includes("not found") || error.message?.includes("Not Found")) {
      return null;
    }
    throw error;
  }
  const text = await data.text();
  return JSON.parse(text) as T;
}

/**
 * Write a JSON file to Supabase Storage `user_data` bucket (upsert).
 */
export async function writeProfileStorage(path: string, body: unknown): Promise<void> {
  const sb = createServiceClient();
  const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
  const { error } = await sb.storage
    .from(PROFILE_BUCKET)
    .upload(path, blob, { contentType: "application/json", upsert: true });
  if (error) throw error;
}

/**
 * List file objects in a folder within Supabase Storage `user_data` bucket.
 * Returns file names (not full paths).
 */
export async function listProfileStorage(folder: string): Promise<string[]> {
  const sb = createServiceClient();
  const { data, error } = await sb.storage.from(PROFILE_BUCKET).list(folder, { limit: 1000 });
  if (error) throw error;
  return (data ?? []).map((f) => f.name);
}
