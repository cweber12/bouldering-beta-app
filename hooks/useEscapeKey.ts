"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `onEscape` when the Escape key is pressed (window-level keydown).
 *
 * Replaces the duplicated ESC-to-close effect in modals and fullscreen
 * portals. `enabled` gates the listener — pass the open/visible flag (defaults
 * to always-on for components that only mount while open).
 *
 * The callback is read through a ref so an inline `onEscape` does not
 * re-subscribe the listener on every render.
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  const cb = useRef(onEscape);
  useEffect(() => {
    cb.current = onEscape;
  });

  useEffect(() => {
    if (!enabled) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") cb.current();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);
}
