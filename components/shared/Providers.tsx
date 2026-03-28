"use client";

import { type ReactNode } from "react";
import { AuthProvider } from "@/hooks/useAuth";

/**
 * Client boundary wrapper for providers that need React context.
 * Mounted once in the root layout.
 */
export default function Providers({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
