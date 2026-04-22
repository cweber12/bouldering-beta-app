import * as admin from "firebase-admin";
export { SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_MS } from "./constants";

/**
 * Server-side Firebase Admin SDK (singleton).
 *
 * Initialised with the service account credentials stored in environment
 * variables.  Must only be imported in server-side code (Route Handlers,
 * Server Components) — never in client bundles.
 *
 * Required env vars (server-side only, never NEXT_PUBLIC_):
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY  (newlines encoded as \n in the env file)
 */
function getAdminApp(): admin.app.App {
  if (admin.apps.length) {
    return admin.apps[0]!;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin credentials are not configured. " +
        "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env.local.",
    );
  }

  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

/**
 * Firebase Admin Auth instance — use for session cookie creation and
 * verification in Route Handlers.
 */
export function getAdminAuth(): admin.auth.Auth {
  return admin.auth(getAdminApp());
}


