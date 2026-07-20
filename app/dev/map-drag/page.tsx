"use client";

import dynamic from "next/dynamic";
import type { ClimbPin } from "@/components/map/ClimbsMap";

const ClimbsMap = dynamic(() => import("@/components/map/ClimbsMap"), { ssr: false });

const DEMO_PINS: ClimbPin[] = [
  {
    lat: 40.015,
    lng: -105.27,
    label: "Boulder Canyon Test",
    runType: "attempt",
    key: "debug-1",
  },
  {
    lat: 39.7392,
    lng: -104.9903,
    label: "Denver Test",
    runType: "send",
    key: "debug-2",
  },
  {
    lat: 40.5853,
    lng: -105.0844,
    label: "Fort Collins Test",
    runType: "attempt",
    key: "debug-3",
  },
];

export default function MapDragDebugPage() {
  return (
    <main className="h-[calc(100dvh-var(--nav-h))] min-h-0 w-full p-4">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-3">
        <header>
          <h1 className="text-sm font-semibold text-fg">Map drag debug harness</h1>
          <p className="text-xs text-fg-muted">
            Drag the map with the mouse and verify center movement. Arrow-key pan should also work.
          </p>
        </header>
        <section className="min-h-0 flex-1 rounded-lg border border-edge/60 bg-surface-alt/20 p-3">
          <ClimbsMap pins={DEMO_PINS} fill />
        </section>
      </div>
    </main>
  );
}
