"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendEmailVerification,
  onIdTokenChanged,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "@/utils/firebase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthContextValue {
  /** Authenticated user, or `null` while loading / when signed out. */
  user: User | null;
  /** `true` until the initial session check completes. */
  loading: boolean;
  /** Sign in with email + password. Returns an error string or `null`. */
  signIn: (email: string, password: string) => Promise<string | null>;
  /** Create a new account with email + password. Returns an error string or `null`. */
  signUp: (email: string, password: string) => Promise<string | null>;
  /** Sign out and clear the session. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Error thrown when the `/api/auth/session` exchange returns a non-ok status. */
class SessionExchangeError extends Error {
  constructor(public readonly status: number) {
    super(`Session exchange failed (${status}).`);
    this.name = "SessionExchangeError";
  }
}

/**
 * POST the Firebase ID token to the session endpoint to create an HTTP-only
 * cookie. Throws {@link SessionExchangeError} when the endpoint does not return
 * a 2xx — a failure here means no `__session` cookie was set, so the caller must
 * treat it as a login failure rather than silently reporting success.
 */
async function createServerSession(idToken: string): Promise<void> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new SessionExchangeError(res.status);
}

/** DELETE the server session cookie. Throws on a non-ok status. */
async function deleteServerSession(): Promise<void> {
  const res = await fetch("/api/auth/session", { method: "DELETE" });
  if (!res.ok) throw new SessionExchangeError(res.status);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Last ID token successfully synced to the server cookie. Firebase can emit
  // the same token repeatedly (re-renders, duplicate emissions); skipping
  // already-synced tokens keeps the listener from hammering the endpoint.
  const lastSyncedTokenRef = useRef<string | null>(null);

  /**
   * Re-mint the `__session` cookie from the current Firebase ID token so the
   * server session never drifts behind the client (Firebase persists the client
   * session in IndexedDB, so it can outlive the cookie). Failures are logged,
   * not surfaced — the user did not just submit a login form here.
   */
  const syncServerSession = useCallback(async (firebaseUser: User): Promise<void> => {
    try {
      const idToken = await firebaseUser.getIdToken();
      if (idToken === lastSyncedTokenRef.current) return;
      await createServerSession(idToken);
      lastSyncedTokenRef.current = idToken;
    } catch (err) {
      console.warn("[auth] session cookie sync failed:", err);
    }
  }, []);

  // Bootstrap: observe Firebase ID token changes (fires on sign-in, sign-out,
  // token refresh, and initial restore) and keep the server cookie in lockstep.
  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsubscribe = onIdTokenChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
      if (firebaseUser) {
        void syncServerSession(firebaseUser);
      } else {
        lastSyncedTokenRef.current = null;
      }
    });
    return unsubscribe;
  }, [syncServerSession]);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    const auth = getFirebaseAuth();
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await credential.user.getIdToken();
      await createServerSession(idToken);
      lastSyncedTokenRef.current = idToken;
      return null;
    } catch (err) {
      // A failed session exchange leaves the Firebase client authenticated but
      // with no server cookie — sign back out so client and server agree, then
      // surface a clear error instead of a silent redirect loop.
      if (err instanceof SessionExchangeError) {
        await firebaseSignOut(auth).catch(() => {});
        return "Could not establish a session. Please try again.";
      }
      return err instanceof Error ? err.message : String(err);
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<string | null> => {
    const auth = getFirebaseAuth();
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      // Send email verification — non-blocking; failure is non-fatal.
      sendEmailVerification(credential.user).catch((e) =>
        console.warn("[auth] sendEmailVerification failed:", e),
      );
      const idToken = await credential.user.getIdToken();
      await createServerSession(idToken);
      lastSyncedTokenRef.current = idToken;
      return null;
    } catch (err) {
      // See signIn: undo the half-authenticated client state on a session-
      // exchange failure so the account isn't left in a broken logged-in limbo.
      if (err instanceof SessionExchangeError) {
        await firebaseSignOut(auth).catch(() => {});
        return "Could not establish a session. Please try again.";
      }
      return err instanceof Error ? err.message : String(err);
    }
  }, []);

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    await firebaseSignOut(auth);
    // Clear the server cookie best-effort — a failed DELETE must not block the
    // local sign-out, or the user gets stuck in a logged-in UI they can't exit.
    await deleteServerSession().catch((e) => console.warn("[auth] deleteServerSession failed:", e));
    lastSyncedTokenRef.current = null;
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Use inside any client component to access the current auth state and actions.
 *
 * ```tsx
 * const { user, signIn, signOut } = useAuth();
 * ```
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an <AuthProvider>");
  return ctx;
}
