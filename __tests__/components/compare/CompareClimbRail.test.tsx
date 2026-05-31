import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompareClimbRail from "@/components/compare/CompareClimbRail";

vi.mock("next/image", () => ({
  default: (props: ComponentProps<"img">) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt ?? ""} />;
  },
}));

const items = [
  { key: "k1", state: "CO", area: "Boulder", route: "Classic", runType: "send", timestamp: "day-one" },
  { key: "k2", state: "CO", area: "Boulder", route: "Classic", runType: "attempt", timestamp: "day-two" },
  { key: "k3", state: "CO", area: "Boulder", route: "Classic", runType: "attempt", timestamp: "day-three" },
];

function stubFetchOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ items, total: items.length }) })),
  );
}

/** Finds the rail button whose visible timestamp matches. */
function buttonByTimestamp(ts: string): HTMLButtonElement {
  return screen.getByText(ts).closest("button") as HTMLButtonElement;
}

describe("CompareClimbRail", () => {
  beforeEach(() => stubFetchOk());
  afterEach(() => vi.unstubAllGlobals());

  const baseProps = {
    userId: "u1",
    state: "CO",
    area: "Boulder",
    route: "Classic",
    minToCompare: 2,
    onAdd: vi.fn(),
    onRemove: vi.fn(),
  };

  it("adds an inactive climb when tapped", async () => {
    const onAdd = vi.fn();
    render(
      <CompareClimbRail
        {...baseProps}
        onAdd={onAdd}
        activeKeys={["k1"]}
        colorForKey={(k) => (k === "k1" ? "#00d273" : null)}
        atMax={false}
      />,
    );

    await waitFor(() => expect(buttonByTimestamp("day-two")).toBeTruthy());
    fireEvent.click(buttonByTimestamp("day-two"));
    expect(onAdd).toHaveBeenCalledWith("k2");
  });

  it("removes an active climb when tapped, and marks it pressed", async () => {
    const onRemove = vi.fn();
    render(
      <CompareClimbRail
        {...baseProps}
        onRemove={onRemove}
        activeKeys={["k1"]}
        colorForKey={(k) => (k === "k1" ? "#00d273" : null)}
        atMax={false}
      />,
    );

    await waitFor(() => expect(buttonByTimestamp("day-one")).toBeTruthy());
    const active = buttonByTimestamp("day-one");
    expect(active.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(active);
    expect(onRemove).toHaveBeenCalledWith("k1");
  });

  it("disables inactive climbs when the comparison is full", async () => {
    const onAdd = vi.fn();
    render(
      <CompareClimbRail
        {...baseProps}
        onAdd={onAdd}
        activeKeys={["k1", "k2"]}
        colorForKey={(k) => (k === "k1" || k === "k2" ? "#00d273" : null)}
        atMax
      />,
    );

    await waitFor(() => expect(buttonByTimestamp("day-three")).toBeTruthy());
    const locked = buttonByTimestamp("day-three");
    expect(locked.disabled).toBe(true);
    fireEvent.click(locked);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("prompts to add a climb when only one is active", async () => {
    render(
      <CompareClimbRail
        {...baseProps}
        activeKeys={["k1"]}
        colorForKey={(k) => (k === "k1" ? "#00d273" : null)}
        atMax={false}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Add a climb to compare")).toBeTruthy(),
    );
  });
});
