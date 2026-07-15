import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GroundTruthReviewer from "@/components/dev/GroundTruthReviewer";
import type { GroundTruthFrame } from "@/utils/harnessGroundTruth";

function frame(overrides: Partial<GroundTruthFrame> = {}): GroundTruthFrame {
  return {
    frameIndex: 0,
    timestamp: 1.0,
    state: "present",
    review: "auto",
    verified: false,
    joints: {
      nose: { x: 0.5, y: 0.2, occluded: false },
      left_wrist: { x: 0.4, y: 0.6, occluded: true },
    },
    ...overrides,
  };
}

function renderReviewer(overrides: Partial<GroundTruthFrame> = {}) {
  const onFlagChange = vi.fn();
  const seedFrame = frame();
  const currentFrame = { ...seedFrame, ...overrides };
  render(
    <GroundTruthReviewer
      videoSrc="blob:video"
      videoWidth={720}
      videoHeight={1280}
      frame={currentFrame}
      seedFrame={seedFrame}
      contextKeypoints={{ left_eye: { x: 0.52, y: 0.18 } }}
      onFlagChange={onFlagChange}
    />,
  );
  return { onFlagChange };
}

describe("GroundTruthReviewer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the three-way review control and emits flags", () => {
    const { onFlagChange } = renderReviewer();

    fireEvent.click(screen.getByRole("button", { name: "Wrong" }));
    expect(onFlagChange).toHaveBeenCalledWith("wrong");

    fireEvent.click(screen.getByRole("button", { name: "Absent" }));
    expect(onFlagChange).toHaveBeenCalledWith("absent");

    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(onFlagChange).toHaveBeenCalledWith("auto");
  });

  it("marks the active review flag pressed", () => {
    renderReviewer({ review: "human-flagged-wrong" });

    expect(screen.getByRole("button", { name: "Wrong" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Auto" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("surfaces occluded seed joints as hollow read-only joints", () => {
    renderReviewer();

    expect(screen.getByText("1 occluded")).toBeTruthy();
    expect(screen.getByText(/Occluded seed joints are hollow/i)).toBeTruthy();
    expect(screen.getByLabelText("Read-only Ground Truth seed skeleton")).toBeTruthy();
  });

  it("does not render landmark editing controls", () => {
    renderReviewer();

    expect(screen.queryByRole("button", { name: /Accept as-is/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Translate whole pose/i })).toBeNull();
    expect(screen.queryByTitle(/Toggle nose occluded/i)).toBeNull();
    expect(screen.queryByTitle(/Place right_wrist/i)).toBeNull();
  });
});
