import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LANDING_REPLAY_VERSION,
  REPLAY_ASPECT_TOLERANCE,
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
 * The PRD's payload budget, in bytes. Every visitor downloads this file in one
 * request before the hero draws anything, so the ceiling is the point of the
 * budget rather than a guideline — a fourth clip that busts it is a curation
 * decision to make out loud, not something to notice later in devtools.
 *
 * **The total is the binding constraint.** The per-item figure is a smell
 * detector for one clip carrying the whole set, and it is deliberately loose:
 * how many bytes a clip spends is mostly how busy its Route Photo is, which
 * neither the serializer nor the curator controls directly. The curated set runs
 * 241-429 KB a clip at 1009 KB total — Slashface's photo costs 45 KB and
 * Midnight Lightning's costs 208 KB at the same quality and a comparable pixel
 * count, purely because one wall has more in front of it. 440 KB admits that
 * spread; a clip past it is genuinely anomalous and worth looking at.
 *
 * (Issue 01 set this at 420 KB from the one clip that existed then, and issue
 * 04's curation immediately produced a legitimate 429 KB export.)
 */
const ITEM_BYTES_MAX = 440 * 1024;
const ASSET_BYTES_MAX = 1.2 * 1024 * 1024;

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

  it("stays inside the payload budget, per clip and for the whole playlist", () => {
    // Compared as an object so a failure names the clip that busts the budget
    // rather than reporting a bare number.
    for (const item of items) {
      const bytes = Buffer.byteLength(JSON.stringify(item), "utf8");
      expect({ id: item.id, overBudget: bytes > ITEM_BYTES_MAX }).toEqual({
        id: item.id,
        overBudget: false,
      });
    }
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(ASSET_BYTES_MAX);
  });

  it("holds one stage shape, so no item letterboxes behind the first", () => {
    // The stage takes its shape from items[0].source and keeps it for the whole
    // playlist so a handoff cannot reflow the page. Mixed aspects still *play* —
    // the assembly script warns and writes — but a mixed-aspect asset is not
    // something to discover on the landing page, so the gate refuses it.
    const stage = items[0].source.w / items[0].source.h;
    for (const [index, item] of items.entries()) {
      const aspect = item.source.w / item.source.h;
      expect({
        index,
        letterboxed: Math.abs(aspect - stage) / stage > REPLAY_ASPECT_TOLERANCE,
      }).toEqual({ index, letterboxed: false });
    }
  });

  it("exposes only the contract's fields, and only labels as text", () => {
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([...ITEM_KEYS].sort());
      expect(Object.keys(item.label).sort()).toEqual([...LABEL_KEYS].sort());
      for (const value of Object.values(item.label)) expect(typeof value).toBe("string");
      expect(Object.keys(item.photo).sort()).toEqual(["h", "w", "webp"]);
      expect(item.photo.webp.startsWith("data:image/webp")).toBe(true);
      // The wall still is optional, but when present it is a WebP like the photo.
      expect(Object.keys(item.source).sort()).toEqual(
        item.source.webp ? ["h", "w", "webp"] : ["h", "w"],
      );
      if (item.source.webp) expect(item.source.webp.startsWith("data:image/webp")).toBe(true);
    }
  });

  it("carries no private Run surface", () => {
    for (const item of items) {
      // Both WebP payloads are opaque base64 — scanning them for words only
      // produces chance matches (a real asset hit "s3" inside the wall still), so
      // they are checked by prefix above and dropped from the text scan here.
      const scanned = JSON.stringify({
        ...item,
        source: { w: item.source.w, h: item.source.h },
        photo: { w: item.photo.w, h: item.photo.h },
      });
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
