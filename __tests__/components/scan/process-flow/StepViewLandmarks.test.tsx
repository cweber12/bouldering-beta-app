import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StepViewLandmarks from "@/components/scan/process-flow/StepViewLandmarks";
import { AdvancedViewProvider } from "@/hooks/useAdvancedView";
import type { RouteAttempt } from "@/storage/sessionStore";

/** StepViewLandmarks reads the Developer-view preference, so it must render
 *  inside the AdvancedViewProvider. */
function renderStep(props: Props) {
  return render(
    <AdvancedViewProvider>
      <StepViewLandmarks {...props} />
    </AdvancedViewProvider>,
  );
}

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

type Props = Parameters<typeof StepViewLandmarks>[0];

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    isProcessing: false,
    currentFrame: 1,
    totalFrames: 10,
    progressPct: 100,
    orbStatus: "ready",
    frameStep: 5,
    processingError: null,
    activeAttempt: makeAttempt(40, 240),
    firstFrameFile: null,
    firstFrameSkeletonData: {
      frames: [{ timestamp: 0, keypoints: { nose: { x: 1, y: 1 } } }],
      duration: 1,
      fps: 30,
    },
    topoStyle: { lineThickness: 0.02, jointRadius: 0.09 },
    onSkeletonStyleChange: () => {},
    onEditClimb: vi.fn(),
    onScanAnother: vi.fn(),
    orbReady: true,
    onViewOnRoutePhoto: vi.fn(),
    onUpload: vi.fn(),
    s3Saved: false,
    s3Loading: false,
    saveError: null,
    onViewScans: vi.fn(),
    ...overrides,
  };
}

describe("StepViewLandmarks", () => {
  it("shows Place on route, Save scan, and a back arrow in the footer when results are ready", () => {
    renderStep(baseProps());

    // The promoted hero action places the climb on a route photo.
    expect(screen.getByRole("button", { name: "Place on route" })).toBeTruthy();

    // Save scan (raw scan) is demoted to a secondary action in the footer bar.
    const save = screen.getByRole("button", { name: "Save scan" });
    expect(save.closest("footer")).not.toBeNull();

    // Back arrow (to Step 2) lives at the far left of the footer bar.
    expect(screen.getByRole("button", { name: "Back to previous step" })).toBeTruthy();

    // The removed quality chip and Edit / Scan another buttons are gone.
    expect(screen.queryByRole("button", { name: /Quality/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scan another" })).toBeNull();
  });

  it("hides footer actions and shows the success banner after upload", () => {
    renderStep(baseProps({ s3Saved: true }));

    expect(screen.queryByRole("button", { name: "Save scan" })).toBeNull();
    expect(screen.getByText("Scan saved successfully")).toBeTruthy();
  });

  it("shows the no-detection empty state and hides Place on route / Save scan when no skeleton was built", () => {
    renderStep(baseProps({ firstFrameSkeletonData: null }));

    expect(screen.getByText("No climber detected in this scan")).toBeTruthy();
    // Save scan / Place on route are meaningless with nothing to project — gone.
    expect(screen.queryByRole("button", { name: "Save scan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Place on route" })).toBeNull();
    // Recovery actions back to detection / a fresh scan are offered instead.
    expect(screen.getByRole("button", { name: "Adjust detection" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan another" })).toBeTruthy();
  });
});
