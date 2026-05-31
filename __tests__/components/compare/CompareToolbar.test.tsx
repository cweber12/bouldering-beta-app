import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CompareToolbar from "@/components/compare/CompareToolbar";
import { EMPTY_HIGHLIGHT } from "@/utils/bodyRegions";

function setup(overrides: Partial<React.ComponentProps<typeof CompareToolbar>> = {}) {
  const props = {
    viewMode: "overlay" as const,
    onViewMode: vi.fn(),
    masterPlaying: false,
    onTogglePlayAll: vi.fn(),
    highlight: EMPTY_HIGHLIGHT,
    onHighlightChange: vi.fn(),
    refineOpen: false,
    onToggleRefine: vi.fn(),
    ...overrides,
  };
  render(<CompareToolbar {...props} />);
  return props;
}

describe("CompareToolbar", () => {
  it("switches view mode via the segmented control", () => {
    const { onViewMode } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Side by side/i }));
    expect(onViewMode).toHaveBeenCalledWith("sidebyside");
  });

  it("shows Play all only in side-by-side mode", () => {
    setup({ viewMode: "overlay" });
    expect(screen.queryByRole("button", { name: /Play all/i })).toBeNull();
  });

  it("toggles play-all in side-by-side mode", () => {
    const { onTogglePlayAll } = setup({ viewMode: "sidebyside" });
    fireEvent.click(screen.getByRole("button", { name: /Play all/i }));
    expect(onTogglePlayAll).toHaveBeenCalledTimes(1);
  });

  it("toggles the refine panel", () => {
    const { onToggleRefine } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Refine/i }));
    expect(onToggleRefine).toHaveBeenCalledTimes(1);
  });

  it("renders the Single|Multiple control only when wired", () => {
    setup();
    expect(screen.queryByRole("group", { name: /Console mode/i })).toBeNull();

    setup({ consoleMode: "multiple", onConsoleMode: vi.fn() });
    expect(screen.getByRole("group", { name: /Console mode/i })).toBeTruthy();
  });

  it("switches console mode via the segmented control", () => {
    const onConsoleMode = vi.fn();
    setup({ consoleMode: "multiple", onConsoleMode });
    fireEvent.click(screen.getByRole("button", { name: /Single/i }));
    expect(onConsoleMode).toHaveBeenCalledWith("single");
  });

  it("hides view-mode and Play all in single mode", () => {
    setup({ consoleMode: "single", viewMode: "sidebyside", onConsoleMode: vi.fn() });
    expect(screen.queryByRole("group", { name: /View mode/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Play all/i })).toBeNull();
    // Focus tools stay available in single mode.
    expect(screen.getByRole("button", { name: /Refine/i })).toBeTruthy();
  });

  it("shows view-mode control in multiple mode", () => {
    setup({ consoleMode: "multiple", onConsoleMode: vi.fn() });
    expect(screen.getByRole("group", { name: /View mode/i })).toBeTruthy();
  });
});
