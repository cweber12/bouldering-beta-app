import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClimbDetailModal, { type ClimbDetailData } from "@/components/shared/ClimbDetailModal";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next/image", () => ({
  default: (props: ComponentProps<"img">) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt ?? ""} />;
  },
}));

describe("ClimbDetailModal", () => {
  const climb: ClimbDetailData = {
    key: "run-1",
    state: "Colorado",
    area: "Boulder",
    route: "The Classic",
    runType: "send",
    timestamp: "2026-05-30",
    rating: "V3",
    notes: "Nice movement.",
    thumbnail: "/thumb.jpg",
  };

  beforeEach(() => {
    pushMock.mockReset();
  });

  it("focuses the close button and closes on Escape", async () => {
    const onClose = vi.fn();

    render(<ClimbDetailModal climb={climb} onClose={onClose} />);

    const closeButton = screen.getByRole("button", { name: "Close" });
    await waitFor(() => expect(document.activeElement).toBe(closeButton));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("navigates to view when the primary action is used", () => {
    const onClose = vi.fn();

    render(<ClimbDetailModal climb={climb} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /View on route photo/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/view?key=run-1");
  });
});
