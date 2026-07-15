import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GroundTruthSeedStatus from "@/components/dev/GroundTruthSeedStatus";

describe("GroundTruthSeedStatus", () => {
  it("shows ViTPose coverage when authoring is ready", () => {
    render(
      <GroundTruthSeedStatus
        gate={{ authoring: "ready" }}
        posedCount={7}
        frameCount={9}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("ViTPose seed · 7/9 posed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry ViTPose/i })).toBeNull();
  });

  it("shows pending status while the scaffold job runs", () => {
    render(
      <GroundTruthSeedStatus
        gate={{ authoring: "pending" }}
        posedCount={0}
        frameCount={0}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Building ViTPose scaffold…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry ViTPose/i })).toBeNull();
  });

  it("gates authoring with a retry action when ViTPose fails", () => {
    const onRetry = vi.fn();
    render(
      <GroundTruthSeedStatus
        gate={{ authoring: "disabled", reason: "The ViTPose job timed out." }}
        posedCount={0}
        frameCount={0}
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByText(
        "Ground Truth review requires a ViTPose scaffold. The ViTPose job timed out.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry ViTPose" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
