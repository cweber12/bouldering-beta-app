"use client";

import { useOpenCV } from "@/hooks/useOpenCV";
import { useTFModel, type PoseModelName } from "@/hooks/useTFModel";

interface LoadingGateProps {
  children: React.ReactNode;
  /** Override the pose model used by the app. Defaults to movenet_lightning. */
  poseModel?: PoseModelName;
  /**
   * Set to false on pages that only need OpenCV (match, compare).
   * Skips waiting for the TF.js pose model, which is only needed during video
   * processing on the upload page. Defaults to true.
   */
  requiresTF?: boolean;
}

/**
 * Blocks rendering until OpenCV.js is ready, and optionally the TF.js pose
 * model too (requiresTF=true, the default). Pages that only run ORB matching
 * or homography can pass requiresTF={false} to avoid loading MoveNet.
 */
export default function LoadingGate({
  children,
  poseModel = "movenet_lightning",
  requiresTF = true,
}: LoadingGateProps) {
  const { ready: cvReady } = useOpenCV();
  const { ready: tfReady } = useTFModel(poseModel);

  const pending = !cvReady || (requiresTF && !tfReady);

  if (pending) {
    const label = (() => {
      if (!cvReady && requiresTF && !tfReady) return "Loading OpenCV + TensorFlow.jsâ€¦";
      if (!cvReady) return "Loading OpenCV.jsâ€¦";
      return "Loading pose modelâ€¦";
    })();
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface text-fg">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-edge border-t-fg" />
        <p className="text-sm font-medium tracking-wide">{label}</p>
      </div>
    );
  }

  return <>{children}</>;
}
