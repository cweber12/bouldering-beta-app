import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StepViewLandmarks from "@/components/scan/process-flow/StepViewLandmarks";
import type { RouteAttempt } from "@/storage/sessionStore";

const baseAttempt = {
  id: "run-1",
  videoMeta: { name: "v.mp4", duration: 4, fps: 30, width: 640, height: 480 },
  frames: [{ timestamp: 0, keypoints: [] }],
  orbFeatures: { keypoints: [{ pt: { x: 1, y: 1 }, size: 1, angle: 0, response: 0, octave: 0 }], descriptors: new Uint8Array(32) },
  matchesPerFrame: null,
  runType: "attempt",
} as unknown as RouteAttempt;

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
        activeAttempt={baseAttempt}
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

    expect(screen.getByText("Optional branch")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Optional Route Overlay" })).toBeTruthy();
  });
});
