"use client";

import { useEffect, useRef, type RefObject } from "react";

type PointerDismissEvent = "mousedown" | "pointerdown" | "click";

/**
 * Calls `onOutside` when a pointer event lands outside `ref`'s element.
 *
 * Replaces the hand-rolled close-on-outside-click effect copied across
 * dropdowns, panels and popovers. `enabled` gates the listener (pass the
 * open/visible flag); when false the listener is detached. `eventType`
 * defaults to "mousedown" — pass "pointerdown" for menus that need to react
 * before pointer capture (e.g. RouteConsole's update menu).
 *
 * The callback is read through a ref so an inline `onOutside` does not
 * re-subscribe the listener on every render.
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: () => void,
  enabled = true,
  eventType: PointerDismissEvent = "mousedown",
): void {
  const cb = useRef(onOutside);
  useEffect(() => {
    cb.current = onOutside;
  });

  useEffect(() => {
    if (!enabled) return;
    function handler(e: Event) {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) cb.current();
    }
    document.addEventListener(eventType, handler);
    return () => document.removeEventListener(eventType, handler);
  }, [ref, enabled, eventType]);
}
