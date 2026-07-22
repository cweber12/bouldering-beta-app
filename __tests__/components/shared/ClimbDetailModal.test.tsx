import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClimbDetailModal, { type ClimbDetailData } from "@/components/shared/ClimbDetailModal";

const pushMock = vi.fn();
let mockUser: { uid: string } | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock("next/image", () => ({
  default: (props: ComponentProps<"img">) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt ?? ""} />;
  },
}));

// Stub the picker so its own S3 fetch never runs — we only assert it mounts.
vi.mock("@/components/compare/CompareWithMinePicker", () => ({
  default: () => <div data-testid="run-picker" />,
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
    mockUser = null;
  });

  it("focuses the close button and closes on Escape", async () => {
    const onClose = vi.fn();

    render(<ClimbDetailModal climb={climb} onClose={onClose} />);

    const closeButton = screen.getByRole("button", { name: "Close" });
    await waitFor(() => expect(document.activeElement).toBe(closeButton));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the climb console scoped to the route when Open is used", () => {
    const onClose = vi.fn();

    render(<ClimbDetailModal climb={climb} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /^Open$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(
      "/compare?keys=run-1&state=Colorado&area=Boulder&route=The%20Classic",
    );
  });

  const otherUsersClimb: ClimbDetailData = {
    ...climb,
    key: "RouteData/other-user/Colorado/Boulder/The Classic/run-1700000000000-send.json",
  };

  it("hides 'Compare with mine' for my own climb", () => {
    mockUser = { uid: "other-user" }; // I am the owner of otherUsersClimb's key
    render(<ClimbDetailModal climb={otherUsersClimb} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /compare with mine/i })).toBeNull();
  });

  it("shows 'Compare with mine' for another user's climb and opens the picker", () => {
    mockUser = { uid: "me" };
    render(<ClimbDetailModal climb={otherUsersClimb} onClose={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /compare with mine/i });
    fireEvent.click(btn);
    expect(screen.getByTestId("run-picker")).toBeTruthy();
  });

  it("hides 'Compare with mine' when signed out", () => {
    mockUser = null;
    render(<ClimbDetailModal climb={otherUsersClimb} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /compare with mine/i })).toBeNull();
  });
});
