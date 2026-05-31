import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ToolPageShell from "@/components/shared/ToolPageShell";

describe("ToolPageShell", () => {
  it("renders children and applies viewport-fit shell classes", () => {
    const { container } = render(
      <ToolPageShell>
        <div>Shell content</div>
      </ToolPageShell>,
    );

    expect(screen.getByText("Shell content")).toBeTruthy();
    const main = container.querySelector("main");
    expect(main).toBeTruthy();
    expect(main?.className).toContain("h-[calc(100dvh-var(--nav-h))]");
    expect(main?.className).toContain("overflow-hidden");
  });

  it("merges custom class names", () => {
    const { container } = render(
      <ToolPageShell className="custom-shell">
        <div>Content</div>
      </ToolPageShell>,
    );

    const main = container.querySelector("main");
    expect(main?.className).toContain("custom-shell");
  });
});
