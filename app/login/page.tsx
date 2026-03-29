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
          <h1 className="text-2xl font-bold tracking-tight text-[#F5FBE6]">
            {mode === "login" ? "Sign in" : "Create account"}
          </h1>
          <p className="text-sm text-[#8fbfc0]">
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
            <label htmlFor="email" className="text-xs font-medium text-[#8fbfc0]">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="rounded-lg border border-[#2d4e5e] bg-[#192e3a] px-3 py-2.5 text-sm text-[#F5FBE6] outline-none transition placeholder:text-[#3d6e7a] focus:border-[#FE7F2D]/60"
              placeholder="you@example.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-medium text-[#8fbfc0]">
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
              className="rounded-lg border border-[#2d4e5e] bg-[#192e3a] px-3 py-2.5 text-sm text-[#F5FBE6] outline-none transition placeholder:text-[#3d6e7a] focus:border-[#FE7F2D]/60"
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
            className="rounded-xl bg-[#FE7F2D] px-6 py-3 text-sm font-semibold text-[#F5FBE6] transition hover:bg-[#e56015] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting
              ? "Please wait\u2026"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <div className="flex items-center justify-center gap-1 text-xs text-[#6a9ca0]">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => { setMode("signup"); setError(null); setSignupSuccess(false); }}
                className="font-medium text-[#c5dcd8] hover:text-[#F5FBE6] transition"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => { setMode("login"); setError(null); setSignupSuccess(false); }}
                className="font-medium text-[#c5dcd8] hover:text-[#F5FBE6] transition"
              >
                Sign in
              </button>
            </>
          )}
        </div>

        <Link
          href="/"
          className="text-center text-xs text-[#6a9ca0] transition hover:text-[#8fbfc0]"
        >
          &larr; Back to home
        </Link>
      </div>
    </main>
  );
}
