"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendEmailVerification,
  onAuthStateChanged,
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

/** POST the Firebase ID token to the session endpoint to create an HTTP-only cookie. */
async function createServerSession(idToken: string): Promise<void> {
  await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

/** DELETE the server session cookie. */
async function deleteServerSession(): Promise<void> {
  await fetch("/api/auth/session", { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Bootstrap: observe Firebase auth state changes and keep loading true
  // until the initial check resolves.
  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      try {
        const auth = getFirebaseAuth();
        const credential = await signInWithEmailAndPassword(auth, email, password);
        const idToken = await credential.user.getIdToken();
        await createServerSession(idToken);
        return null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return msg;
      }
    },
    [],
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      try {
        const auth = getFirebaseAuth();
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        // Send email verification — non-blocking; failure is non-fatal.
        sendEmailVerification(credential.user).catch((e) =>
          console.warn("[auth] sendEmailVerification failed:", e),
        );
        const idToken = await credential.user.getIdToken();
        await createServerSession(idToken);
        return null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return msg;
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    await firebaseSignOut(auth);
    await deleteServerSession();
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
