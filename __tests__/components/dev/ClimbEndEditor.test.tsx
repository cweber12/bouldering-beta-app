import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClimbEndEditor from "@/components/dev/ClimbEndEditor";

/**
 * jsdom implements no media playback: `duration` reports NaN and seeking is a
 * no-op. Stub just enough of HTMLMediaElement for the editor's scrub position —
 * which is what the marker is read off — to behave.
 */
function stubMedia(duration: number) {
  let time = 0;
  Object.defineProperty(HTMLMediaElement.prototype, "duration", {
    configurable: true,
    get: () => duration,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get: () => time,
    set: (v: number) => {
      time = v;
    },
  });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
}

/** Mount and drive the video to `loadeddata`, which is what opens the editor. */
function mount(props: Partial<React.ComponentProps<typeof ClimbEndEditor>> = {}) {
  const onCommit = vi.fn();
  const view = render(
    <ClimbEndEditor videoSrc="blob:video" onCommit={onCommit} {...props} />,
  );
  const video = view.container.querySelector("video")!;
  fireEvent.loadedData(video);
  return { ...view, onCommit, video };
}

describe("ClimbEndEditor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens at the last Detection Frame on an unmarked bundle and commits that frame", () => {
    stubMedia(10);
    const { onCommit } = mount({ climbStart: 1.2 });

    // A topout sits near the end of the clip, so the search is a short drag back.
    const set = screen.getByRole("button", { name: /Set climb end — 0:10\.0/ });
    fireEvent.click(set);

    expect(onCommit).toHaveBeenCalledWith(10);
  });

  it("snaps a scrub between frames onto the Detection Frame grid", () => {
    stubMedia(10);
    const { onCommit } = mount({ climbStart: 1.2 });

    fireEvent.change(screen.getByLabelText("Video progress"), { target: { value: "4.26" } });
    fireEvent.click(screen.getByRole("button", { name: /Set climb end — 0:04\.3/ }));

    expect(onCommit).toHaveBeenCalledWith(4.3);
  });

  it("opens at the saved marker and can clear it back to unmarked", () => {
    stubMedia(10);
    const { onCommit } = mount({ climbStart: 1.2, climbEnd: 6.4 });

    expect(screen.getByRole("button", { name: /Set climb end — 0:06\.4/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear marker" }));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("offers no clear on an unmarked bundle, so absence is never written as a value", () => {
    stubMedia(10);
    mount({ climbStart: 1.2 });

    expect(screen.getByRole("button", { name: "Clear marker" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("refuses a marker at or before the climb start with a reason, never clamping it", () => {
    stubMedia(10);
    const { onCommit } = mount({ climbStart: 10 });

    // The opening position is the last frame, which is the climb start itself.
    expect(screen.getByText(/at or before the setup tap at 0:10\.0/)).toBeTruthy();

    const set = screen.getByRole("button", { name: /Set climb end/ });
    expect(set.hasAttribute("disabled")).toBe(true);
    fireEvent.click(set);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("surfaces a failed write verbatim rather than swallowing it", () => {
    stubMedia(10);
    mount({
      climbStart: 1.2,
      error: "Invalid end-of-climb marker — it must be a time after the climb start.",
    });

    expect(
      screen.getByText("Invalid end-of-climb marker — it must be a time after the climb start."),
    ).toBeTruthy();
  });

  it("frames the candidate in a local ±2 s strip, marking the saved frame distinctly", () => {
    stubMedia(300);
    mount({ climbStart: 1.2, climbEnd: 100 });

    // Local, not the whole 3001-frame grid — thumbnailing a whole video per
    // bundle is what makes a ninety-bundle sweep an afternoon.
    const cells = screen.getAllByTestId("climb-end-strip-cell");
    expect(cells).toHaveLength(41);
    expect(cells.filter((c) => c.hasAttribute("data-pending"))).toHaveLength(1);
    expect(cells.filter((c) => c.hasAttribute("data-marked"))).toHaveLength(1);
  });

  it("locks the controls while a write is in flight", () => {
    stubMedia(10);
    mount({ climbStart: 1.2, climbEnd: 6.4, busy: true });

    expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Clear marker" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
