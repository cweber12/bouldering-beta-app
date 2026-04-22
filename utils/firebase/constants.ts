/**
 * Shared Firebase auth constants — safe to import in both Edge (middleware)
 * and Node.js (API routes) runtimes.
 *
 * Do NOT import firebase-admin here.
 */

/** Name of the HTTP-only session cookie set after sign-in. */
export const SESSION_COOKIE_NAME = "__session";

/** Session cookie lifetime — 14 days (maximum allowed by Firebase). */
export const SESSION_COOKIE_MAX_AGE_MS = 60 * 60 * 24 * 14 * 1000;
