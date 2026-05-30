import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ProcessFlowShell from "@/components/scan/process-flow/ProcessFlowShell";

describe("ProcessFlowShell", () => {
  it("renders step progress semantics and heading", () => {
    render(
      <ProcessFlowShell step={2} totalSteps={4} title="Set Detection" subtitle="Crop and run scan">
        <div>Inner content</div>
      </ProcessFlowShell>,
    );

    expect(screen.getByRole("heading", { name: "Set Detection" })).toBeTruthy();
    expect(screen.getByText("Step 2 of 4")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Process progress" })).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("renders action rail when actions are supplied", () => {
    render(
      <ProcessFlowShell
        step={1}
        totalSteps={4}
        title="Pick"
        subtitle="Select source"
        primaryAction={<button type="button">Next</button>}
        secondaryAction={<button type="button">Back</button>}
      >
        <div>Inner content</div>
      </ProcessFlowShell>,
    );

    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });
});
