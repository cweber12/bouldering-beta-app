import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ToolRouteHeader from "@/components/layout/ToolRouteHeader";

describe("ToolRouteHeader", () => {
  it("renders title and subtitle", () => {
    render(<ToolRouteHeader title="Scan" subtitle="Capture and process your climb." />);

    expect(screen.getByRole("heading", { name: "Scan" })).toBeTruthy();
    expect(screen.getByText("Capture and process your climb.")).toBeTruthy();
  });

  it("renders optional actions", () => {
    render(<ToolRouteHeader title="Compare" actions={<button type="button">Action</button>} />);

    expect(screen.getByRole("button", { name: "Action" })).toBeTruthy();
  });
});
