"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client (singleton per page load).
 *
 * Uses `@supabase/ssr` which stores the session in cookies automatically,
 * keeping it in sync with the server-side middleware.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
