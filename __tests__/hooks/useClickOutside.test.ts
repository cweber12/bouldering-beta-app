import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";

// Renders the hook with a ref bound to `inside`, so events on `inside` are
// "inside" and events anywhere else are "outside".
function renderClickOutside(
  inside: HTMLElement,
  onOutside: () => void,
  enabled = true,
  eventType: "mousedown" | "pointerdown" | "click" = "mousedown",
) {
  return renderHook(() => {
    const ref = useRef<HTMLElement>(inside);
    useClickOutside(ref, onOutside, enabled, eventType);
  });
}

describe("useClickOutside", () => {
  let inside: HTMLDivElement;
  let outside: HTMLDivElement;

  beforeEach(() => {
    inside = document.createElement("div");
    outside = document.createElement("div");
    document.body.append(inside, outside);
  });

  afterEach(() => {
    inside.remove();
    outside.remove();
    vi.unstubAllGlobals();
  });

  it("fires when a mousedown lands outside the ref element", () => {
    const onOutside = vi.fn();
    renderClickOutside(inside, onOutside);

    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the event lands inside the ref element", () => {
    const onOutside = vi.fn();
    renderClickOutside(inside, onOutside);

    inside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("does not attach a listener when disabled", () => {
    const onOutside = vi.fn();
    renderClickOutside(inside, onOutside, false);

    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("respects a custom event type (pointerdown)", () => {
    const onOutside = vi.fn();
    renderClickOutside(inside, onOutside, true, "pointerdown");

    // mousedown is ignored, pointerdown triggers
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onOutside).not.toHaveBeenCalled();
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("detaches the listener on unmount", () => {
    const onOutside = vi.fn();
    const { unmount } = renderClickOutside(inside, onOutside);
    unmount();

    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("calls the latest callback without re-subscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const ref = { current: inside };
    const { rerender } = renderHook(({ cb }) => useClickOutside(ref, cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
