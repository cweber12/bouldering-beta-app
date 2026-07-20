import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GroundTruthReviewer from "@/components/dev/GroundTruthReviewer";
import type { ReviewFlag } from "@/utils/harnessGroundTruthScaffold";
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

function renderReviewer({
  flag = "auto",
  seed = {},
  inheritedFrom = null,
}: { flag?: ReviewFlag; seed?: Partial<GroundTruthFrame>; inheritedFrom?: number | null } = {}) {
  const onFlagChange = vi.fn();
  render(
    <GroundTruthReviewer
      videoSrc="blob:video"
      videoWidth={720}
      videoHeight={1280}
      seedFrame={frame(seed)}
      flag={flag}
      inheritedFrom={inheritedFrom}
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

  it("renders only the Auto and Wrong controls (no Absent) and emits flags", () => {
    const { onFlagChange } = renderReviewer();

    fireEvent.click(screen.getByRole("button", { name: "Wrong" }));
    expect(onFlagChange).toHaveBeenCalledWith("wrong");

    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(onFlagChange).toHaveBeenCalledWith("auto");

    // The manual Absent control is gone — presence follows the seed (ADR 0005).
    expect(screen.queryByRole("button", { name: "Absent" })).toBeNull();
  });

  it("marks the active review flag pressed", () => {
    renderReviewer({ flag: "wrong" });

    expect(screen.getByRole("button", { name: "Wrong" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Auto" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("disables the Wrong control on a zero-joint (seeded-absent) frame", () => {
    const { onFlagChange } = renderReviewer({ seed: { state: "absent", joints: {} } });

    const wrong = screen.getByRole("button", { name: "Wrong" });
    expect(wrong.hasAttribute("disabled")).toBe(true);
    fireEvent.click(wrong);
    expect(onFlagChange).not.toHaveBeenCalledWith("wrong");

    // Auto stays available — a seeded-absent frame can still anchor an Auto fill.
    expect(screen.getByRole("button", { name: "Auto" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows the inherited-source hint on a derived frame, naming the boundary as mm:ss.s", () => {
    // Governing boundary at 63.4s (1:03.4) — the frame inherits Wrong from it.
    renderReviewer({ flag: "wrong", inheritedFrom: 63.4 });

    const hint = screen.getByTestId("inherited-hint");
    expect(hint.textContent).toContain("inherited from");
    expect(hint.textContent).toContain("1:03.4");
    // The active flag is named in the hint.
    expect(hint.textContent).toContain("wrong");
    // The default review caption is replaced by the hint.
    expect(screen.queryByText(/Occluded seed joints are hollow/i)).toBeNull();
  });

  it("shows no inherited hint on a control-point / default-auto frame", () => {
    renderReviewer({ flag: "wrong", inheritedFrom: null });

    expect(screen.queryByTestId("inherited-hint")).toBeNull();
    expect(screen.getByText(/Occluded seed joints are hollow/i)).toBeTruthy();
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
