"use client";

import { useEffect, useState } from "react";

// Extend the global Window type to expose the cv object injected by opencv.js.
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cv: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Module: any;
  }
}

// Module-level flag so multiple hook instances share one load attempt.
let loadStarted = false;
const listeners: Array<() => void> = [];

function notifyLoaded() {
  listeners.forEach((fn) => fn());
  listeners.length = 0;
}

/**
 * Loads opencv.js (served from /public/opencv.js) via a script tag and waits
 * for the WASM runtime to be fully initialized.
 *
 * Safe under React StrictMode: the module-level `loadStarted` guard prevents
 * the script from being injected twice when effects fire twice in dev.
 */
export function useOpenCV(): { ready: boolean; cv: Window["cv"] | null } {
  const [ready, setReady] = useState<boolean>(() => {
    // If the page was hydrated and opencv.js already finished loading, start ready.
    if (typeof window !== "undefined" && window.cv?.Mat) return true;
    return false;
  });

  useEffect(() => {
    // If the useState initializer already caught a loaded cv, nothing to do.
    if (ready) return;

    // Register this component instance to be notified when loading finishes.
    const onLoaded = () => setReady(true);
    listeners.push(onLoaded);

    // If cv is already fully available, resolve immediately.
    if (window.cv?.Mat) {
      notifyLoaded();
      return () => {
        const idx = listeners.indexOf(onLoaded);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    }

    const cleanupListener = () => {
      const idx = listeners.indexOf(onLoaded);
      if (idx !== -1) listeners.splice(idx, 1);
    };

    if (!loadStarted) {
      loadStarted = true;

      // Ensure Module exists before loading opencv.js.
      window.Module = window.Module ?? {};
      const prevModuleInit = window.Module.onRuntimeInitialized;
      window.Module.onRuntimeInitialized = () => {
        prevModuleInit?.();
        notifyLoaded();
      };

      const script = document.createElement("script");
      script.id = "opencv-js";
      script.src = "/opencv.js";
      script.async = true;
      script.onload = () => {
        // Some builds expose cv.onRuntimeInitialized rather than Module callback.
        if (window.cv && !window.cv.Mat) {
          const prevCvInit = window.cv.onRuntimeInitialized;
          window.cv.onRuntimeInitialized = () => {
            prevCvInit?.();
            notifyLoaded();
          };
        }
        // If runtime is already initialized by onload time, unblock immediately.
        if (window.cv?.Mat) notifyLoaded();
      };
      script.onerror = () => {
        console.error(
          "[useOpenCV] Failed to load /opencv.js. " +
            "Download it and place it in /public — see public/README.md.",
        );
        loadStarted = false; // allow retry on hot-reload
      };
      document.body.appendChild(script);
    } else {
      // If another hook already started loading, attach to existing script events.
      const existing = document.getElementById("opencv-js") as HTMLScriptElement | null;
      if (existing && window.cv && !window.cv.Mat) {
        const prevCvInit = window.cv.onRuntimeInitialized;
        window.cv.onRuntimeInitialized = () => {
          prevCvInit?.();
          notifyLoaded();
        };
      }
      if (window.cv?.Mat) notifyLoaded();
    }

    return cleanupListener;
  }, [ready]);

  return { ready, cv: ready ? window.cv : null };
}
