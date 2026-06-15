"use client";

import { type ReactNode } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { AdvancedViewProvider } from "@/hooks/useAdvancedView";

/**
 * Client boundary wrapper for providers that need React context.
 * Mounted once in the root layout.
 */
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AdvancedViewProvider>
        <AuthProvider>{children}</AuthProvider>
      </AdvancedViewProvider>
    </ThemeProvider>
  );
}
