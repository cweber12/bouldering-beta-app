import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LANDING_REPLAY_VERSION,
  REPLAY_CAPTURE_SECONDS,
  REPLAY_PLAYLIST_MAX,
  isReplayItem,
  readReplayPlaylist,
  type LandingReplayItem,
} from "@/pipeline/overlay/landingReplayItem";

// ---------------------------------------------------------------------------
// The checked-in playlist asset.
//
// The serializer excludes private fields by construction and is tested at that
// boundary; this is the gate on the artifact that actually ships. It runs against
// whatever is in `public/landing-replay.json` — so the privacy check on the public
// content surface is re-run on every commit that touches the asset, rather than
// being a one-off manual review at curation time.
//
// The suite skips when no asset is checked in. That is a supported state, not a
// failure: with no asset the hero renders nothing and the landing page degrades to
// its text content.
// ---------------------------------------------------------------------------

const ASSET_PATH = join(process.cwd(), "public", "landing-replay.json");
const present = existsSync(ASSET_PATH);

/** Every key the v1 contract allows on an item, and nothing else. */
const ITEM_KEYS = [
  "id",
  "label",
  "duration",
  "source",
  "photo",
  "starfield",
  "matches",
  "poses",
  "holds",
] as const;
const LABEL_KEYS = ["area", "route", "rating"] as const;

/**
 * Field names from the Run's private surface. None of them may appear anywhere in
 * an item — the check is on the raw JSON text, so a nested or renamed-container
 * leak is caught as well as a top-level one.
 */
const PRIVATE_MARKERS = [
  "userId",
  "user_id",
  "email",
  "displayName",
  "notes",
  "latitude",
  "longitude",
  "coordinates",
  "location",
  "descriptors",
  "orbFeatures",
  "keyframes",
  "homography",
  "s3",
  "RouteData",
];

describe.skipIf(!present)("checked-in landing replay asset", () => {
  const raw = present ? readFileSync(ASSET_PATH, "utf8") : "{}";
  const file = JSON.parse(raw) as { version?: unknown; items?: unknown[] };
  const items = (file.items ?? []) as LandingReplayItem[];

  it("is a v1 playlist of 1-5 curated items", () => {
    expect(file.version).toBe(LANDING_REPLAY_VERSION);
    expect(Array.isArray(file.items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(REPLAY_PLAYLIST_MAX);
  });

  it("has every item survive the runtime guard, so the hero plays them all", () => {
    for (const item of items) expect(isReplayItem(item)).toBe(true);
    expect(readReplayPlaylist(file)).toHaveLength(items.length);
  });

  it("gives each item a distinct id and a sane captured span", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const item of items) {
      expect(item.duration).toBeGreaterThan(0);
      expect(item.duration).toBeLessThanOrEqual(REPLAY_CAPTURE_SECONDS);
    }
  });

  it("exposes only the contract's fields, and only labels as text", () => {
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([...ITEM_KEYS].sort());
      expect(Object.keys(item.label).sort()).toEqual([...LABEL_KEYS].sort());
      for (const value of Object.values(item.label)) expect(typeof value).toBe("string");
      expect(Object.keys(item.photo).sort()).toEqual(["h", "w", "webp"]);
      expect(item.photo.webp.startsWith("data:image/webp")).toBe(true);
    }
  });

  it("carries no private Run surface", () => {
    for (const item of items) {
      // The WebP payload is opaque base64 — scanning it for words would only
      // produce chance matches, so it is checked by prefix above and dropped here.
      const scanned = JSON.stringify({ ...item, photo: { w: item.photo.w, h: item.photo.h } });
      for (const marker of PRIVATE_MARKERS) {
        expect(scanned).not.toContain(marker);
      }
    }
  });

  it("keeps every time clip-relative and every coordinate finite", () => {
    for (const item of items) {
      for (const pose of item.poses) {
        expect(pose.t).toBeGreaterThanOrEqual(0);
        expect(pose.t).toBeLessThanOrEqual(item.duration);
        for (const [index, x, y] of [...pose.source, ...pose.photo]) {
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(33);
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        }
      }
      for (const hold of item.holds) {
        expect(hold.t).toBeGreaterThanOrEqual(0);
        expect(hold.t).toBeLessThanOrEqual(item.duration);
      }
      for (const point of item.starfield) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      }
    }
  });
});
