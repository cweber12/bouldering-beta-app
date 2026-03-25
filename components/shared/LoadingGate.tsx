"use client";

import { useOpenCV } from "@/hooks/useOpenCV";
import { useTFModel, type PoseModelName } from "@/hooks/useTFModel";

interface LoadingGateProps {
  children: React.ReactNode;
  /** Override the pose model used by the app. Defaults to movenet_lightning. */
  poseModel?: PoseModelName;
}

/**
 * Blocks rendering until both OpenCV.js and the TF.js pose model are ready.
 * Wrap the root of the app (or any CV-dependent subtree) in this component.
 */
export default function LoadingGate({ children, poseModel = "movenet_lightning" }: LoadingGateProps) {
  const { ready: cvReady } = useOpenCV();
  const { ready: tfReady } = useTFModel(poseModel);

  if (!cvReady || !tfReady) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-300">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-600 border-t-zinc-200" />
        <p className="text-sm font-medium tracking-wide">
          {!cvReady && !tfReady && "Loading OpenCV + TensorFlow.js…"}
          {!cvReady && tfReady && "Loading OpenCV.js…"}
          {cvReady && !tfReady && "Loading pose model…"}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
