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

  it("renders thumbnails when supplied and a status placeholder otherwise", () => {
    render(
      <DetectionFrameStepper
        frames={[
          { timestamp: 0, status: "detected" },
          { timestamp: 1, status: "missing" },
        ]}
        thumbnails={["data:image/png;base64,AAAA", undefined]}
        currentIndex={0}
        onSeek={vi.fn()}
      />,
    );

    // Frame 0 has a thumbnail → an <img>; its cell carries the detected border.
    const detectedCell = screen.getByLabelText("Seek to 0:00 (detected)");
    const img = detectedCell.querySelector("img");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(detectedCell.className).toContain("border-send");

    // Frame 1 has no thumbnail → a status-colored placeholder, missing border.
    const missingCell = screen.getByLabelText("Seek to 0:01 (missing)");
    expect(missingCell.querySelector("img")).toBeNull();
    expect(missingCell.className).toContain("border-danger");
  });

  it("rings the active frame's cell", () => {
    render(
      <DetectionFrameStepper
        frames={[
          { timestamp: 0, status: "detected" },
          { timestamp: 1, status: "detected" },
        ]}
        currentIndex={1}
        onSeek={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Seek to 0:00 (detected)").className).not.toContain("ring-fg");
    expect(screen.getByLabelText("Seek to 0:01 (detected)").className).toContain("ring-fg");
  });

  it("keeps the seeded-absent dot but drops the redundant per-frame Wrong dot", () => {
    render(
      <DetectionFrameStepper
        frames={[
          { timestamp: 0, status: "detected" },
          { timestamp: 1, status: "detected" },
          { timestamp: 2, status: "detected" },
          { timestamp: 3, status: "missing" },
        ]}
        frameMarks={["auto", "flagged-wrong", "flagged-absent", "seeded-absent"]}
        currentIndex={0}
        onSeek={vi.fn()}
      />,
    );

    // The Wrong dot is gone — the Wrong-stretch bar carries that signal. Only the
    // seeded-absent (and legacy flagged-absent) dots remain.
    const markers = screen.getAllByTestId("frame-mark-marker");
    expect(markers.map((m) => m.getAttribute("data-mark"))).toEqual([
      "flagged-absent",
      "seeded-absent",
    ]);
    expect(markers.some((m) => m.getAttribute("data-mark") === "flagged-wrong")).toBe(false);

    // The mark is still surfaced in the bar title for authoring feedback.
    expect(screen.getByTitle("0:03 · missing · seeded absent")).toBeTruthy();
  });

  it("draws one continuous Wrong-stretch bar bridging a seeded-absent gap", () => {
    render(
      <DetectionFrameStepper
        frames={[
          { timestamp: 0 },
          { timestamp: 1 },
          { timestamp: 2 },
          { timestamp: 3 },
          { timestamp: 4 },
        ]}
        // Wrong from 1 to 3, with a seeded-absent gap at 2 the bar bridges.
        frameMarks={["auto", "flagged-wrong", "seeded-absent", "flagged-wrong", "auto"]}
        wrongStretches={[{ start: 1, end: 3 }]}
        currentIndex={0}
        onSeek={vi.fn()}
      />,
    );

    // A single unbroken bar spans the stretch (no break across the gap).
    expect(screen.getAllByTestId("flagged-stretch")).toHaveLength(1);
    // The gap frame keeps its own dot under the bar.
    const markers = screen.getAllByTestId("frame-mark-marker");
    expect(markers.map((m) => m.getAttribute("data-mark"))).toEqual(["seeded-absent"]);
  });

  it("jumps to the start of the next Wrong stretch, and is disabled when none follows", () => {
    const onSeek = vi.fn();
    const { rerender } = render(
      <DetectionFrameStepper
        frames={[
          { timestamp: 0 },
          { timestamp: 1 },
          { timestamp: 2 },
          { timestamp: 3 },
          { timestamp: 4 },
        ]}
        wrongStretches={[
          { start: 1, end: 1 },
          { start: 3, end: 4 },
        ]}
        currentIndex={0}
        onSeek={onSeek}
      />,
    );

    const jump = screen.getByRole("button", { name: /jump to next wrong stretch/i });
    fireEvent.click(jump);
    expect(onSeek).toHaveBeenCalledWith(1);

    // Parked past the last stretch's start, nothing follows → disabled.
    rerender(
      <DetectionFrameStepper
        frames={[
          { timestamp: 0 },
          { timestamp: 1 },
          { timestamp: 2 },
          { timestamp: 3 },
          { timestamp: 4 },
        ]}
        wrongStretches={[
          { start: 1, end: 1 },
          { start: 3, end: 4 },
        ]}
        currentIndex={3}
        onSeek={onSeek}
      />,
    );
    expect(
      screen.getByRole("button", { name: /jump to next wrong stretch/i }).hasAttribute("disabled"),
    ).toBe(true);
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
