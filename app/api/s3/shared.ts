import { S3Client } from "@aws-sdk/client-s3";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** The S3 key prefix scoping all RouteData objects. */
export const S3_PREFIX = process.env.S3_KEY_PREFIX ?? "RouteData";

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
