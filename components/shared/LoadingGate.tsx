"use client";

import { useOpenCV } from "@/hooks/useOpenCV";

interface LoadingGateProps {
  children: React.ReactNode;
}

/**
 * Blocks rendering until OpenCV.js is ready.
 */
export default function LoadingGate({ children }: LoadingGateProps) {
  const { ready: cvReady } = useOpenCV();

  if (!cvReady) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface text-fg">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-edge border-t-fg" />
        <p className="text-sm font-medium tracking-wide">Loading OpenCV.js&#8230;</p>
      </div>
    );
  }

  return <>{children}</>;
}
