import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ScanProgress from "@/components/scan/process-flow/ScanProgress";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";

// Canvas getContext is stubbed to null globally (vitest.setup.ts), so all the
// drawing paths in ScanProgress no-op — these tests exercise the bar chrome,
// the progress/finishing states, and cancel wiring, and assert the canvas-heavy
// render survives being handed real ORB + pose data without throwing.

const pose: PoseFrame = {
  timestamp: 0.1,
  keypoints: [
    { name: "left_shoulder", x: 0.4, y: 0.3, score: 0.9 },
    { name: "right_shoulder", x: 0.6, y: 0.3, score: 0.9 },
    { name: "left_hip", x: 0.42, y: 0.6, score: 0.8 },
    { name: "right_hip", x: 0.58, y: 0.6, score: 0.8 },
  ],
};

describe("ScanProgress", () => {
  it("shows the scanning percentage while a scan is running", () => {
    render(
      <ScanProgress
        orbPreview={null}
        currentPose={null}
        videoAspect={null}
        progressPct={42}
        finishing={false}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Scanning")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("shows a finishing message once the seek loop completes", () => {
    render(
      <ScanProgress
        orbPreview={null}
        currentPose={null}
        videoAspect={null}
        progressPct={100}
        finishing
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Finishing up/)).toBeTruthy();
    expect(screen.queryByText("100%")).toBeNull();
  });

  it("calls onCancel when the cancel control is pressed", () => {
    const onCancel = vi.fn();
    render(
      <ScanProgress
        orbPreview={null}
        currentPose={null}
        videoAspect={null}
        progressPct={10}
        finishing={false}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByLabelText("Cancel scan"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders with ORB keypoints and a detected pose without throwing", () => {
    expect(() =>
      render(
        <ScanProgress
          orbPreview={[{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.5 }, { x: 0.5, y: 0.9 }]}
          currentPose={pose}
          videoAspect={{ w: 1080, h: 1920 }}
          progressPct={75}
          finishing={false}
          onCancel={() => {}}
        />,
      ),
    ).not.toThrow();
  });
});
