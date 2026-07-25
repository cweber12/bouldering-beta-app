import { describe, it, expect } from "vitest";
import {
  isReplayItem,
  LANDING_REPLAY_VERSION,
  REPLAY_CLIP_SECONDS,
  type LandingReplayItem,
} from "@/pipeline/overlay/landingReplayItem";

function validItem(): LandingReplayItem {
  return {
    id: "run-1750000000-boulder-problem",
    label: { area: "Chaos Canyon", route: "Boulder Problem", rating: "V4" },
    source: { w: 1080, h: 1920 },
    photo: { w: 1200, h: 1600, webp: "data:image/webp;base64,AAAA" },
    starfield: [{ x: 0.12, y: 0.44 }],
    matches: [{ sx: 0.12, sy: 0.44, px: 0.31, py: 0.52 }],
    poses: [
      {
        t: 0,
        source: [{ n: "left_wrist", x: 0.4, y: 0.3, s: 0.9 }],
        photo: [{ n: "left_wrist", x: 0.5, y: 0.4, s: 0.9 }],
      },
    ],
    holds: [{ x: 0.3, y: 0.5, kind: "hand", side: "left", t: 1.2 }],
  };
}

describe("contract constants", () => {
  it("pins version 1 and an 8-second clip", () => {
    expect(LANDING_REPLAY_VERSION).toBe(1);
    expect(REPLAY_CLIP_SECONDS).toBe(8);
  });
});

describe("isReplayItem", () => {
  it("accepts a well-formed item", () => {
    expect(isReplayItem(validItem())).toBe(true);
  });

  it("rejects non-objects", () => {
    for (const value of [null, undefined, 4, "item", true, []]) {
      expect(isReplayItem(value)).toBe(false);
    }
  });

  it("rejects an item missing its id or label strings", () => {
    expect(isReplayItem({ ...validItem(), id: 7 })).toBe(false);
    expect(isReplayItem({ ...validItem(), label: { area: "a" } })).toBe(false);
    expect(isReplayItem({ ...validItem(), label: undefined })).toBe(false);
  });

  it("rejects malformed dimensions", () => {
    expect(isReplayItem({ ...validItem(), source: { w: "1080", h: 1920 } })).toBe(false);
    expect(isReplayItem({ ...validItem(), photo: { w: 1, h: 2 } })).toBe(false);
    expect(isReplayItem({ ...validItem(), photo: { w: 1, h: 2, webp: 9 } })).toBe(false);
  });

  it("rejects an item whose geometry arrays are missing", () => {
    for (const field of ["starfield", "matches", "holds", "poses"] as const) {
      expect(isReplayItem({ ...validItem(), [field]: undefined })).toBe(false);
      expect(isReplayItem({ ...validItem(), [field]: {} })).toBe(false);
    }
  });

  it("rejects an item with no poses at all", () => {
    expect(isReplayItem({ ...validItem(), poses: [] })).toBe(false);
  });

  it("rejects a first pose missing its time or either coordinate space", () => {
    const item = validItem();
    expect(isReplayItem({ ...item, poses: [{ source: [], photo: [] }] })).toBe(false);
    expect(isReplayItem({ ...item, poses: [{ t: 0, photo: [] }] })).toBe(false);
    expect(isReplayItem({ ...item, poses: [{ t: 0, source: [] }] })).toBe(false);
  });

  it("stays narrow — a malformed later pose is not inspected", () => {
    const item = validItem();
    const loose = { ...item, poses: [...item.poses, { t: "late" }] };
    expect(isReplayItem(loose)).toBe(true);
  });
});
