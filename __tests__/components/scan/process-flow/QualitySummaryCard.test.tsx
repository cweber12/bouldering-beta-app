import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import QualitySummaryCard from "@/components/scan/process-flow/QualitySummaryCard";
import FixSuggestionsPanel from "@/components/scan/process-flow/FixSuggestionsPanel";

describe("QualitySummaryCard", () => {
  it("shows pass state copy and toggles metrics label", () => {
    const onToggleDetails = vi.fn();

    render(
      <QualitySummaryCard
        score={88}
        status="pass"
        summary="Looks good"
        poseFrames={140}
        orbPoints={320}
        frameStep={5}
        showDetails={false}
        onToggleDetails={onToggleDetails}
      />,
    );

    expect(screen.getByText("Quality Check: Good")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Show advanced metrics" });
    fireEvent.click(toggle);
    expect(onToggleDetails).toHaveBeenCalledTimes(1);
  });

  it("shows warn state and advanced values when expanded", () => {
    render(
      <QualitySummaryCard
        score={42}
        status="warn"
        summary="Needs adjustments"
        poseFrames={18}
        orbPoints={90}
        frameStep={20}
        showDetails
        onToggleDetails={() => {}}
      />,
    );

    expect(screen.getByText("Quality Check: Needs Attention")).toBeTruthy();
    expect(screen.getByText("18")).toBeTruthy();
    expect(screen.getByText("90")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();
  });
});

describe("FixSuggestionsPanel", () => {
  it("renders suggestions and wires action handlers", () => {
    const action = vi.fn();
    render(
      <FixSuggestionsPanel
        suggestions={[
          {
            id: "pose",
            title: "Improve climber tracking",
            detail: "Tighten crop",
            actionLabel: "Edit crop",
            onAction: action,
          },
        ]}
      />,
    );

    expect(screen.getByText("Improve climber tracking")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit crop" }));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
