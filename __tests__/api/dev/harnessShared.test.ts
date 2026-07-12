import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import {
  isSafeSegment,
  parseBundleKey,
  relativeVideoPath,
  resolveBundleDir,
} from "@/app/api/dev/shared";

describe("isSafeSegment", () => {
  it("accepts real route folders and video keys", () => {
    expect(isSafeSegment("maze-of-death")).toBe(true);
    expect(isSafeSegment("rSG7CCI0WSc_20260708-101112")).toBe(true);
    expect(isSafeSegment("v1.2")).toBe(true);
  });

  it("rejects traversal, separators, and hidden/leading-junk names", () => {
    for (const bad of ["", ".", "..", "../x", "a/b", "a\\b", ".hidden", " x", "-x"]) {
      expect(isSafeSegment(bad)).toBe(false);
    }
  });
});

describe("parseBundleKey", () => {
  it("splits a valid two-segment key", () => {
    expect(parseBundleKey("maze-of-death/vid_1")).toEqual({
      routeFolder: "maze-of-death",
      videoKey: "vid_1",
    });
  });

  it("rejects wrong arity or unsafe segments", () => {
    expect(parseBundleKey("only-one")).toBeNull();
    expect(parseBundleKey("a/b/c")).toBeNull();
    expect(parseBundleKey("../etc/passwd")).toBeNull();
    expect(parseBundleKey("route/..")).toBeNull();
    expect(parseBundleKey("route/")).toBeNull();
  });
});

describe("relativeVideoPath", () => {
  it("builds the external-API relative path", () => {
    expect(relativeVideoPath("maze-of-death", "vid_1")).toBe(
      "analysis/maze-of-death/vid_1/vid_1.mp4",
    );
  });
});

describe("resolveBundleDir", () => {
  const root = path.resolve("/tmp/analysis-root");

  beforeEach(() => {
    process.env.HARNESS_ANALYSIS_ROOT = root;
  });
  afterEach(() => {
    delete process.env.HARNESS_ANALYSIS_ROOT;
  });

  it("resolves a safe key to a directory within the root", () => {
    expect(resolveBundleDir("route/vid")).toBe(path.join(root, "route", "vid"));
  });

  it("rejects keys that would escape the root", () => {
    expect(resolveBundleDir("../../etc/passwd")).toBeNull();
    expect(resolveBundleDir("route/..")).toBeNull();
    expect(resolveBundleDir("..%2f..%2f")).toBeNull();
  });

  it("returns null when the root is unconfigured", () => {
    delete process.env.HARNESS_ANALYSIS_ROOT;
    expect(resolveBundleDir("route/vid")).toBeNull();
  });
});
