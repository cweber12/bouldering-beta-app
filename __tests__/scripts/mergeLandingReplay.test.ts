import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// The assembly script is plain ESM run by `node` with no build step, so it
// mirrors the contract's constants and guard rather than importing them. These
// tests import both sides and assert they agree — that mirror is the one place
// this script can drift from what the hero will actually accept.
import {
  assemble,
  aspectWarnings,
  isReplayItemLike,
  parseArgs,
  readClip,
  report,
} from "../../scripts/merge-landing-replay.mjs";
import {
  LANDING_REPLAY_VERSION,
  REPLAY_PLAYLIST_MAX,
  isReplayItem,
  type LandingReplayItem,
} from "@/pipeline/overlay/landingReplayItem";

// ---------------------------------------------------------------------------
// Fixtures — the smallest thing the runtime guard accepts, so a test that fails
// fails on the rule under test rather than on fixture drift.
// ---------------------------------------------------------------------------

const WEBP = "data:image/webp;base64,AAAA";

function item(id: string, overrides: Partial<LandingReplayItem> = {}): LandingReplayItem {
  return {
    id,
    label: { area: "Boulder Field", route: id, rating: "V4" },
    duration: 20,
    source: { w: 1920, h: 1080, webp: WEBP },
    photo: { w: 960, h: 540, webp: WEBP },
    starfield: [{ x: 0.5, y: 0.5 }],
    matches: [{ sx: 0.5, sy: 0.5, px: 0.5, py: 0.5 }],
    poses: [{ t: 0, source: [[0, 0.5, 0.5, 0.9]], photo: [[0, 0.5, 0.5, 0.9]] }],
    holds: [],
    ...overrides,
  };
}

function clip(path: string, ...items: LandingReplayItem[]) {
  return { path, items };
}

const tmp = mkdtempSync(join(tmpdir(), "merge-landing-replay-"));
const SCRIPT = join(process.cwd(), "scripts", "merge-landing-replay.mjs");

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function writeClip(name: string, value: unknown): string {
  const path = join(tmp, name);
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
}

/** Run the CLI, returning its exit code and streams rather than throwing. */
function run(...args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("merge-landing-replay assembly", () => {
  it("concatenates items in argument order, because argument order is play order", () => {
    const { file } = assemble([
      clip("a.json", item("run-a")),
      clip("b.json", item("run-b1"), item("run-b2")),
      clip("c.json", item("run-c")),
    ]);

    expect(file.version).toBe(LANDING_REPLAY_VERSION);
    expect(file.items.map((i: LandingReplayItem) => i.id)).toEqual([
      "run-a",
      "run-b1",
      "run-b2",
      "run-c",
    ]);
  });

  it("refuses duplicate ids, naming both files that carry the clip", () => {
    const merge = () => assemble([clip("a.json", item("run-a")), clip("b.json", item("run-a"))]);

    expect(merge).toThrow(/duplicate id run-a/);
    expect(merge).toThrow(/a\.json and b\.json/);
  });

  it("refuses more items than the hero will play, rather than letting the rest drop silently", () => {
    const over = Array.from({ length: REPLAY_PLAYLIST_MAX + 1 }, (_, i) =>
      clip(`clip-${i}.json`, item(`run-${i}`)),
    );

    expect(() => assemble(over)).toThrow(
      new RegExp(`${REPLAY_PLAYLIST_MAX + 1} items.*at most ${REPLAY_PLAYLIST_MAX}`),
    );
  });

  it("refuses an item the runtime guard would drop", () => {
    const broken = { ...item("run-a"), poses: [] } as unknown as LandingReplayItem;
    expect(isReplayItem(broken)).toBe(false);

    expect(() => assemble([clip("a.json", broken)])).toThrow(
      /a\.json item 0 is not a landing replay item/,
    );
  });

  it("agrees with the contract's runtime guard on what an item is", () => {
    const cases: unknown[] = [
      item("run-a"),
      { ...item("run-a"), source: { w: 1920, h: 1080 } }, // wall still is optional
      { ...item("run-a"), id: 7 },
      { ...item("run-a"), duration: 0 },
      { ...item("run-a"), label: { area: "Field" } },
      { ...item("run-a"), photo: { w: 1, h: 1 } },
      { ...item("run-a"), source: null },
      { ...item("run-a"), starfield: undefined },
      { ...item("run-a"), holds: "none" },
      { ...item("run-a"), poses: [{ source: [], photo: [] }] },
      null,
      "run-a",
    ];

    for (const value of cases) {
      expect({ value, guard: isReplayItemLike(value) }).toEqual({
        value,
        guard: isReplayItem(value),
      });
    }
  });
});

describe("merge-landing-replay aspect warnings", () => {
  const landscape = item("run-a");
  const portrait = item("run-b", { source: { w: 1080, h: 1920, webp: WEBP } });

  it("warns that a disagreeing item letterboxes, naming the item and the stage setter", () => {
    const warnings = aspectWarnings([landscape, portrait]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/item 1 \(run-b\)/);
    expect(warnings[0]).toMatch(/item 0 sets the stage/);
    expect(warnings[0]).toMatch(/letterbox/);
  });

  it("still writes the playlist, because a mixed-aspect set plays", () => {
    const { file, warnings } = assemble([clip("a.json", landscape), clip("b.json", portrait)]);

    expect(file.items).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });

  it("stays quiet on near-identical aspects and on a single item", () => {
    const nudged = item("run-b", { source: { w: 1918, h: 1080, webp: WEBP } });

    expect(aspectWarnings([landscape, nudged])).toEqual([]);
    expect(aspectWarnings([portrait])).toEqual([]);
  });
});

describe("merge-landing-replay input reading", () => {
  it("reads the authoring route's wrapper and a bare item alike", () => {
    const wrapper = writeClip("wrapper.json", {
      version: LANDING_REPLAY_VERSION,
      items: [item("run-a")],
    });
    const bare = writeClip("bare.json", item("run-b"));

    expect(readClip(wrapper).map((i: LandingReplayItem) => i.id)).toEqual(["run-a"]);
    expect(readClip(bare).map((i: LandingReplayItem) => i.id)).toEqual(["run-b"]);
  });

  it("refuses a missing or unparseable input with the path in the message", () => {
    const missing = join(tmp, "nope.json");
    const garbage = join(tmp, "garbage.json");
    writeFileSync(garbage, "{ not json", "utf8");

    expect(() => readClip(missing)).toThrow(/cannot read .*nope\.json \(ENOENT\)/);
    expect(() => readClip(garbage)).toThrow(/garbage\.json is not valid JSON/);
  });

  it("takes the last --out and refuses an unknown option", () => {
    expect(parseArgs(["--out", "x.json", "a.json", "b.json"])).toMatchObject({
      out: "x.json",
      inputs: ["a.json", "b.json"],
    });
    expect(parseArgs(["a.json"])).toMatchObject({ out: "public/landing-replay.json" });
    expect(() => parseArgs([])).toThrow(/no clips given/);
    expect(() => parseArgs(["--force"])).toThrow(/unknown option --force/);
  });
});

describe("merge-landing-replay reporting", () => {
  it("reports the total and a per-clip breakdown, so the budget is visible when spent", () => {
    const file = { version: LANDING_REPLAY_VERSION, items: [item("run-a"), item("run-b")] };
    const text = report(file, JSON.stringify(file));

    expect(text).toMatch(/2 items, [\d.]+ KB total/);
    expect(text).toMatch(/run-a.*KB.*images.*Boulder Field/);
    expect(text).toMatch(/run-b.*KB.*images/);
  });
});

describe("merge-landing-replay CLI", () => {
  it("writes the playlist in argument order and prints the breakdown", () => {
    const a = writeClip("cli-a.json", { version: 1, items: [item("run-a")] });
    const b = writeClip("cli-b.json", { version: 1, items: [item("run-b")] });
    const out = join(tmp, "playlist.json");

    const result = run("--out", out, b, a);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Wrote");
    expect(result.stdout).toMatch(/2 items/);
    const written = JSON.parse(readFileSync(out, "utf8"));
    expect(written.items.map((i: LandingReplayItem) => i.id)).toEqual(["run-b", "run-a"]);
  });

  it("fails a bad input with a readable line, not a stack trace", () => {
    const result = run(join(tmp, "absent.json"));

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("merge-landing-replay: cannot read");
    expect(result.stderr).not.toMatch(/^\s+at /m);
  });
});
