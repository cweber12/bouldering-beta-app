import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LandmarkEditor from "@/components/dev/LandmarkEditor";
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

function renderEditor(overrides: Partial<GroundTruthFrame> = {}) {
  const onSetState = vi.fn();
  const onToggleOccluded = vi.fn();
  const onEditJoints = vi.fn();
  const onAccept = vi.fn();
  render(
    <LandmarkEditor
      videoSrc="blob:video"
      videoWidth={720}
      videoHeight={1280}
      frame={frame(overrides)}
      seedJoints={{}}
      contextKeypoints={{}}
      onEditJoints={onEditJoints}
      onSetState={onSetState}
      onToggleOccluded={onToggleOccluded}
      onAccept={onAccept}
    />,
  );
  return { onSetState, onToggleOccluded, onEditJoints, onAccept };
}

describe("LandmarkEditor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets frame state from the present / absent / skip control", () => {
    const { onSetState } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Absent" }));
    expect(onSetState).toHaveBeenCalledWith("absent");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSetState).toHaveBeenCalledWith("skip");
  });

  it("marks the active state pressed", () => {
    renderEditor({ state: "skip" });
    expect(screen.getByRole("button", { name: "Skip" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Present" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("toggles a placed joint's occlusion from the palette", () => {
    const { onToggleOccluded } = renderEditor();
    fireEvent.click(screen.getByTitle("Toggle nose occluded"));
    expect(onToggleOccluded).toHaveBeenCalledWith("nose");
    // The already-occluded joint offers the inverse action.
    fireEvent.click(screen.getByTitle("Toggle left_wrist visible"));
    expect(onToggleOccluded).toHaveBeenCalledWith("left_wrist");
  });

  it("shows the occluded count in the readout", () => {
    renderEditor();
    expect(screen.getByText("1 occluded")).toBeTruthy();
  });

  it("accepts the frame as-is", () => {
    const { onAccept } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /accept as-is/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});
