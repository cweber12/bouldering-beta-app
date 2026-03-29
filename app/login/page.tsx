"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

export default function LoginPage() {
  const { signIn, signUp, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Validate redirect to prevent open-redirect attacks (OWASP A01:2021).
  const rawRedirect = searchParams.get("redirect") ?? "/upload";
  const redirect = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") && !rawRedirect.includes("://")
    ? rawRedirect
    : "/upload";

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      setSignupSuccess(false);

      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password) {
        setError("Email and password are required.");
        setSubmitting(false);
        return;
      }

      if (mode === "login") {
        const err = await signIn(trimmedEmail, password);
        if (err) {
          setError(err);
          setSubmitting(false);
        } else {
          router.push(redirect);
        }
      } else {
        const err = await signUp(trimmedEmail, password);
        if (err) {
          setError(err);
          setSubmitting(false);
        } else {
          setSignupSuccess(true);
          setSubmitting(false);
        }
      }
    },
    [email, password, mode, signIn, signUp, router, redirect],
  );

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-fg">
            {mode === "login" ? "Sign in" : "Create account"}
          </h1>
          <p className="text-sm text-fg-secondary">
            {mode === "login"
              ? "Sign in to access your climbing data."
              : "Create a free account to get started."}
          </p>
        </div>

        {signupSuccess && (
          <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
            Account created! Check your email for a confirmation link, then sign in.
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-medium text-fg-secondary">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="rounded-lg border border-edge bg-inset px-3 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-placeholder focus:border-accent/60"
              placeholder="you@example.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-medium text-fg-secondary">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="rounded-lg border border-edge bg-inset px-3 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-placeholder focus:border-accent/60"
              placeholder={mode === "signup" ? "At least 6 characters" : ""}
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || authLoading}
            className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-fg transition hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting
              ? "Please wait\u2026"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <div className="flex items-center justify-center gap-1 text-xs text-fg-muted">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => { setMode("signup"); setError(null); setSignupSuccess(false); }}
                className="font-medium text-fg-light hover:text-fg transition"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => { setMode("login"); setError(null); setSignupSuccess(false); }}
                className="font-medium text-fg-light hover:text-fg transition"
              >
                Sign in
              </button>
            </>
          )}
        </div>

        <Link
          href="/"
          className="text-center text-xs text-fg-muted transition hover:text-fg-secondary"
        >
          &larr; Back to home
        </Link>
      </div>
    </main>
  );
}
