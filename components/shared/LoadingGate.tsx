"use client";

import { useOpenCV } from "@/hooks/useOpenCV";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

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
        <LoadingSpinner className="border-[3px] border-edge/50 border-t-accent" />
        <p className="text-body-sm font-medium tracking-wide text-fg-secondary">Loading OpenCV.js&#8230;</p>
      </div>
    );
  }

  return <>{children}</>;
}
