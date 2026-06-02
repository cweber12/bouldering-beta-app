import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ProcessFlowShell from "@/components/scan/process-flow/ProcessFlowShell";

describe("ProcessFlowShell", () => {
  it("renders the step indicator + instruction in the footer bar", () => {
    render(
      <ProcessFlowShell
        step={2}
        totalSteps={4}
        stepName="Set detection"
        instruction="tap the climber"
      >
        <div>Inner content</div>
      </ProcessFlowShell>,
    );

    expect(screen.getByText("Step 2/4")).toBeTruthy();
    expect(screen.getByText("Set detection")).toBeTruthy();
    expect(screen.getByText("tap the climber")).toBeTruthy();
    // No top banner / progress bar in the footer-bar model.
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("renders accessory + actions in the footer right cluster", () => {
    render(
      <ProcessFlowShell
        step={1}
        totalSteps={4}
        stepName="Pick"
        accessory={<span>Quality: Good</span>}
        primaryAction={<button type="button">Next</button>}
        secondaryAction={<button type="button">Back</button>}
      >
        <div>Inner content</div>
      </ProcessFlowShell>,
    );

    expect(screen.getByText("Quality: Good")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });
});
