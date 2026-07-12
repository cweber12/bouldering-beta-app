import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEscapeKey } from "@/hooks/useEscapeKey";

describe("useEscapeKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires onEscape when Escape is pressed", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("does not attach a listener when disabled", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape, false));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("detaches the listener on unmount", () => {
    const onEscape = vi.fn();
    const { unmount } = renderHook(() => useEscapeKey(onEscape));
    unmount();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("calls the latest callback without re-subscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useEscapeKey(cb), { initialProps: { cb: first } });

    rerender({ cb: second });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
