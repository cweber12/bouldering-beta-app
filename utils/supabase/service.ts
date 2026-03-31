import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client with the **service role** key.
 *
 * Bypasses Row-Level Security — use only in API Route Handlers that have
 * already authenticated the caller via `getAuthUserId()`.
 *
 * Requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
 */
let _serviceClient: SupabaseClient | null = null;

/**
 * Extract the `ref` field from a Supabase JWT payload (anon or service_role
 * key).  Returns `undefined` when the token is not a valid JWT or lacks the
 * field.
 */
function extractJwtRef(jwt: string): string | undefined {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return undefined;
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf-8")) as Record<string, unknown>;
    return typeof decoded.ref === "string" ? decoded.ref : undefined;
  } catch {
    return undefined;
  }
}

export function createServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured. " +
        "Add it to .env.local (server-side only).",
    );
  }

  // Validate that the service role key belongs to the same project as the URL.
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRef = extractJwtRef(key);
  const anonRef = anonKey ? extractJwtRef(anonKey) : undefined;
  if (serviceRef && anonRef && serviceRef !== anonRef) {
    console.error(
      `[supabase/service] SUPABASE_SERVICE_ROLE_KEY ref (${serviceRef}) does not match ` +
        `NEXT_PUBLIC_SUPABASE_ANON_KEY ref (${anonRef}). The service key is from a different ` +
        `Supabase project. Profile save and other storage operations will fail. ` +
        `Replace the service role key with the one from your project dashboard.`,
    );
  }

  _serviceClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _serviceClient;
}
