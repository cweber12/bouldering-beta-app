"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Measures the live pixel height of an element via `ResizeObserver`. Returns a
 * callback ref to attach and the latest measured height (0 until first measure).
 *
 * Used to size square-bounded media to the *exact* available vertical space of
 * its stage rather than a brittle `calc(100dvh - …rem)` guess — important now
 * that the available height also drives the media width (the square cap).
 */
export function useMeasuredHeight(): [(el: HTMLElement | null) => void, number] {
  const [height, setHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      setHeight(el.getBoundingClientRect().height);
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setHeight(box.height);
    });
    ro.observe(el);
    observerRef.current = ro;
    setHeight(el.getBoundingClientRect().height);
  }, []);

  return [ref, height];
}
