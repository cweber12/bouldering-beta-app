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

  _serviceClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _serviceClient;
}
