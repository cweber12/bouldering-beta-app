"use client";

import { useEffect } from "react";
import LoadingGate from "@/components/shared/LoadingGate";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useTFModel } from "@/hooks/useTFModel";

function AppReady() {
  const { cv } = useOpenCV();
  const { model } = useTFModel();

  useEffect(() => {
    if (cv && model) {
      console.info("[App] Both runtimes ready. cv:", cv, "| pose model:", model);
    }
  }, [cv, model]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-100 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Bouldering Beta</h1>
      <p className="text-sm text-zinc-400">OpenCV.js and TensorFlow.js are ready.</p>
    </main>
  );
}

export default function Home() {
  return (
    <LoadingGate>
      <AppReady />
    </LoadingGate>
  );
}
