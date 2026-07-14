import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DetectionFrameStepper from "@/components/dev/DetectionFrameStepper";

describe("DetectionFrameStepper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the filmstrip, highlights flagged stretches, and navigates by click", () => {
    const onSeek = vi.fn();
    render(
      <DetectionFrameStepper
        frames={[
          { timestamp: 0, status: "detected" },
          { timestamp: 1, status: "weak" },
          { timestamp: 2, status: "missing" },
          { timestamp: 3, status: "detected" },
          { timestamp: 4, status: "flip" },
        ]}
        currentIndex={0}
        onSeek={onSeek}
        isPlaying
      />,
    );

    expect(screen.getAllByLabelText(/Seek to/)).toHaveLength(5);
    expect(screen.getAllByTestId("flagged-stretch")).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("Seek to 0:04 (flip)"));
    expect(onSeek).toHaveBeenCalledWith(4);
  });

  it("reflects Ground Truth state on the filmstrip (absent / skip distinct)", () => {
    render(
      <DetectionFrameStepper
        frames={[
          { timestamp: 0, status: "detected" },
          { timestamp: 1, status: "detected" },
          { timestamp: 2, status: "missing" },
        ]}
        frameStates={["present", "skip", "absent"]}
        currentIndex={0}
        onSeek={vi.fn()}
      />,
    );

    // Only the non-present frames carry a state marker.
    const markers = screen.getAllByTestId("frame-state-marker");
    expect(markers).toHaveLength(2);
    expect(markers.map((m) => m.getAttribute("data-state"))).toEqual(["skip", "absent"]);

    // State is surfaced in the bar title for authoring feedback.
    expect(screen.getByTitle("0:02 · missing · absent")).toBeTruthy();
  });

  it("steps with the keyboard and jumps to the next flagged stretch", () => {
    const onSeek = vi.fn();
    const onTogglePlay = vi.fn();
    render(
      <DetectionFrameStepper
        frames={[
          { timestamp: 0, status: "detected" },
          { timestamp: 1, status: "detected" },
          { timestamp: 2, status: "weak" },
          { timestamp: 3, status: "missing" },
          { timestamp: 4, status: "detected" },
          { timestamp: 5, status: "flip" },
        ]}
        currentIndex={1}
        onSeek={onSeek}
        onTogglePlay={onTogglePlay}
        isPlaying={false}
      />,
    );

    const stepper = screen.getByRole("group", { name: /detection frame stepper/i });
    stepper.focus();

    fireEvent.keyDown(stepper, { key: "ArrowLeft" });
    expect(onSeek).toHaveBeenCalledWith(0);

    fireEvent.keyDown(stepper, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenCalledWith(2);

    fireEvent.keyDown(stepper, { key: " " });
    expect(onTogglePlay).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /jump to next flagged stretch/i }));
    expect(onSeek).toHaveBeenCalledWith(2);
  });
});
