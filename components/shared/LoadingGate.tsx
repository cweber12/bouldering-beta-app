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
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-fg">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-edge/50 border-t-accent" />
        <p className="text-[13px] font-medium tracking-wide text-fg-secondary">Loading OpenCV.js&#8230;</p>
      </div>
    );
  }

  return <>{children}</>;
}
