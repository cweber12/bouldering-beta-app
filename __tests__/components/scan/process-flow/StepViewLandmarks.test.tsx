import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StepViewLandmarks from "@/components/scan/process-flow/StepViewLandmarks";
import type { RouteAttempt } from "@/storage/sessionStore";

function makeAttempt(frameCount: number, orbCount: number): RouteAttempt {
  return {
    id: "run-1",
    videoMeta: { name: "v.mp4", duration: 4, fps: 30, width: 640, height: 480 },
    frames: Array.from({ length: frameCount }, (_, index) => ({
      timestamp: index * 33,
      keypoints: [],
    })),
    orbFeatures: {
      keypoints: Array.from({ length: orbCount }, (_, index) => ({
        pt: { x: index + 1, y: index + 1 },
        size: 1,
        angle: 0,
        response: 0,
        octave: 0,
      })),
      descriptors: new Uint8Array(Math.max(32, orbCount * 32)),
    },
    matchesPerFrame: null,
    runType: "attempt",
  } as unknown as RouteAttempt;
}

describe("StepViewLandmarks optional branch", () => {
  it("shows optional route overlay branch when orb is ready", () => {
    render(
      <StepViewLandmarks
        isProcessing={false}
        currentFrame={1}
        totalFrames={10}
        progressPct={100}
        orbStatus="ready"
        frameStep={5}
        processingError={null}
        activeAttempt={makeAttempt(40, 240)}
        firstFrameFile={null}
        firstFrameSkeletonData={null}
        topoStyle={{ lineWidth: 2, pointRadius: 3 }}
        onSkeletonStyleChange={() => {}}
        onEditClimb={vi.fn()}
        onScanAnother={vi.fn()}
        orbReady
        onViewOnRoutePhoto={vi.fn()}
        onUpload={vi.fn()}
        s3Saved={false}
        s3Loading={false}
        saveError={null}
        onViewScans={vi.fn()}
      />,
    );

    // Optional overlay entry point is a quiet, demoted secondary action.
    expect(
      screen.getByRole("button", { name: "Overlay on a route photo (optional)" }),
    ).toBeTruthy();

    // The primary Save action lives in the sticky shell footer.
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton.closest("footer")).not.toBeNull();
  });

  it("shows warn summary with targeted fixes and wires recovery actions", () => {
    const onEditClimb = vi.fn();
    const onScanAnother = vi.fn();

    render(
      <StepViewLandmarks
        isProcessing={false}
        currentFrame={1}
        totalFrames={10}
        progressPct={100}
        orbStatus="ready"
        frameStep={20}
        processingError={null}
        activeAttempt={makeAttempt(10, 80)}
        firstFrameFile={null}
        firstFrameSkeletonData={null}
        topoStyle={{ lineWidth: 2, pointRadius: 3 }}
        onSkeletonStyleChange={() => {}}
        onEditClimb={onEditClimb}
        onScanAnother={onScanAnother}
        orbReady
        onViewOnRoutePhoto={vi.fn()}
        onUpload={vi.fn()}
        s3Saved={false}
        s3Loading={false}
        saveError={null}
        onViewScans={vi.fn()}
      />,
    );

    expect(screen.getByText("Quality Check: Needs Attention")).toBeTruthy();
    expect(screen.getByText("Improve climber tracking")).toBeTruthy();
    expect(screen.getByText("Increase sampling frequency")).toBeTruthy();
    expect(screen.getByText("Strengthen ORB reference")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit crop" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Adjust settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Rescan video" }));

    expect(onEditClimb).toHaveBeenCalledTimes(2);
    expect(onScanAnother).toHaveBeenCalledTimes(1);
  });

  it("shows pass summary without fix suggestions", () => {
    render(
      <StepViewLandmarks
        isProcessing={false}
        currentFrame={1}
        totalFrames={10}
        progressPct={100}
        orbStatus="ready"
        frameStep={5}
        processingError={null}
        activeAttempt={makeAttempt(80, 400)}
        firstFrameFile={null}
        firstFrameSkeletonData={null}
        topoStyle={{ lineWidth: 2, pointRadius: 3 }}
        onSkeletonStyleChange={() => {}}
        onEditClimb={vi.fn()}
        onScanAnother={vi.fn()}
        orbReady
        onViewOnRoutePhoto={vi.fn()}
        onUpload={vi.fn()}
        s3Saved={false}
        s3Loading={false}
        saveError={null}
        onViewScans={vi.fn()}
      />,
    );

    expect(screen.getByText("Quality Check: Good")).toBeTruthy();
    expect(screen.queryByText("Improve climber tracking")).toBeNull();
    expect(screen.queryByText("Strengthen ORB reference")).toBeNull();
  });
});
