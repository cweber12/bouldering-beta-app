import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Module mocks — Firebase auth SDK + the client app singleton
// ---------------------------------------------------------------------------

vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  sendEmailVerification: vi.fn(),
  // onAuthStateChanged fires once with null (signed out) then returns an
  // unsubscribe. The provider only uses it to flip `loading` to false.
  onAuthStateChanged: vi.fn((_auth: unknown, cb: (u: unknown) => void) => {
    cb(null);
    return () => {};
  }),
}));

vi.mock("@/utils/firebase/client", () => ({
  getFirebaseAuth: vi.fn(() => ({ __fakeAuth: true })),
}));

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendEmailVerification,
} from "firebase/auth";
import { AuthProvider, useAuth } from "@/hooks/useAuth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

/** A fake Firebase credential whose user mints a dummy ID token. */
function fakeCredential(idToken = "id-token-abc") {
  return { user: { getIdToken: vi.fn().mockResolvedValue(idToken) } };
}

/** Stub global fetch to resolve with the given status. */
function stubFetch(status: number) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  // firebaseSignOut returns a Promise in the real SDK; default it so the
  // `.catch()` guard in the hook has something to chain off.
  (firebaseSignOut as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (sendEmailVerification as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// signIn — session exchange success / failure
// ---------------------------------------------------------------------------

describe("useAuth — signIn session exchange", () => {
  it("returns null and POSTs the id token when the session exchange succeeds", async () => {
    (signInWithEmailAndPassword as ReturnType<typeof vi.fn>).mockResolvedValue(fakeCredential());
    const fetchMock = stubFetch(200);

    const { result } = renderHook(() => useAuth(), { wrapper });

    let outcome: string | null = "unset";
    await act(async () => {
      outcome = await result.current.signIn("a@b.com", "pw123456");
    });

    expect(outcome).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({ method: "POST" }),
    );
    expect(firebaseSignOut).not.toHaveBeenCalled();
  });

  it("returns an error and signs the client back out when the session route 404s", async () => {
    (signInWithEmailAndPassword as ReturnType<typeof vi.fn>).mockResolvedValue(fakeCredential());
    stubFetch(404);

    const { result } = renderHook(() => useAuth(), { wrapper });

    let outcome: string | null = null;
    await act(async () => {
      outcome = await result.current.signIn("a@b.com", "pw123456");
    });

    expect(outcome).toBe("Could not establish a session. Please try again.");
    expect(firebaseSignOut).toHaveBeenCalledTimes(1);
  });

  it("returns an error and signs the client back out when the session route 500s", async () => {
    (signInWithEmailAndPassword as ReturnType<typeof vi.fn>).mockResolvedValue(fakeCredential());
    stubFetch(500);

    const { result } = renderHook(() => useAuth(), { wrapper });

    let outcome: string | null = null;
    await act(async () => {
      outcome = await result.current.signIn("a@b.com", "pw123456");
    });

    expect(outcome).toBe("Could not establish a session. Please try again.");
    expect(firebaseSignOut).toHaveBeenCalledTimes(1);
  });

  it("returns the Firebase error message when credentials are rejected (no session call)", async () => {
    (signInWithEmailAndPassword as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("auth/wrong-password"),
    );
    const fetchMock = stubFetch(200);

    const { result } = renderHook(() => useAuth(), { wrapper });

    let outcome: string | null = null;
    await act(async () => {
      outcome = await result.current.signIn("a@b.com", "wrong");
    });

    expect(outcome).toBe("auth/wrong-password");
    // Session exchange never attempted, client never authenticated → no sign-out.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(firebaseSignOut).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// signUp — session exchange failure
// ---------------------------------------------------------------------------

describe("useAuth — signUp session exchange", () => {
  it("returns an error and signs the client back out when the session route 404s", async () => {
    (createUserWithEmailAndPassword as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeCredential(),
    );
    stubFetch(404);

    const { result } = renderHook(() => useAuth(), { wrapper });

    let outcome: string | null = null;
    await act(async () => {
      outcome = await result.current.signUp("new@b.com", "pw123456");
    });

    expect(outcome).toBe("Could not establish a session. Please try again.");
    expect(firebaseSignOut).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// signOut — resilient to a failed cookie delete
// ---------------------------------------------------------------------------

describe("useAuth — signOut", () => {
  it("clears local state even when the server cookie DELETE fails", async () => {
    (firebaseSignOut as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    stubFetch(404);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signOut();
    });

    expect(firebaseSignOut).toHaveBeenCalledTimes(1);
    expect(result.current.user).toBeNull();
  });
});
