/**
 * The `detectorCodeHash` derivation.
 *
 * These cover the determinism properties — identical code must hash identically
 * across line endings, checkouts and walk order, and nothing environmental may
 * leak in. They do NOT demonstrate that the field catches a hot reload; that is
 * a four-step manual run against a live dev server, recorded in the PR.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DETECTOR_CODE_HASH_LENGTH,
  DETECTOR_SOURCE_DIRS,
  DETECTOR_SOURCE_FILES,
  computeDetectorCodeHash,
  hashDetectorSources,
  listDetectorSourcePaths,
  normalizeSource,
} from "@/app/api/dev/detectorSources";

const LF = "const REACQUIRE_LADDER_SCALES = [1.5, 2.5];\nexport {};\n";
const CRLF = LF.replace(/\n/g, "\r\n");

describe("normalizeSource", () => {
  it("collapses CRLF and lone CR to LF", () => {
    expect(normalizeSource("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("strips a leading BOM only", () => {
    expect(normalizeSource("\uFEFFa\uFEFFb")).toBe("a\uFEFFb");
  });
});

describe("hashDetectorSources", () => {
  const lf = [{ path: "pipeline/tracking/climberTracker.ts", source: LF }];

  it("produces a lowercase hex digest of the contract's length", () => {
    expect(hashDetectorSources(lf)).toMatch(new RegExp(`^[0-9a-f]{${DETECTOR_CODE_HASH_LENGTH}}$`));
  });

  it("is identical for a CRLF and an LF checkout of the same code", () => {
    const crlf = [{ path: "pipeline/tracking/climberTracker.ts", source: CRLF }];
    expect(hashDetectorSources(crlf)).toBe(hashDetectorSources(lf));
  });

  it("is identical whatever order the walk returned the modules in", () => {
    const forward = [
      { path: "a/one.ts", source: "one" },
      { path: "b/two.ts", source: "two" },
      { path: "c/three.ts", source: "three" },
    ];
    expect(hashDetectorSources([...forward].reverse())).toBe(hashDetectorSources(forward));
  });

  it("moves when a module's content changes", () => {
    const nudged = [
      { path: "pipeline/tracking/climberTracker.ts", source: LF.replace("2.5", "2.6") },
    ];
    expect(hashDetectorSources(nudged)).not.toBe(hashDetectorSources(lf));
  });

  it("moves when a module is renamed but its content is unchanged", () => {
    const renamed = [{ path: "pipeline/tracking/climberTrack.ts", source: LF }];
    expect(hashDetectorSources(renamed)).not.toBe(hashDetectorSources(lf));
  });

  it("moves when a module joins or leaves the set", () => {
    const extra = [...lf, { path: "pipeline/pose/flipDetection.ts", source: "export {};\n" }];
    expect(hashDetectorSources(extra)).not.toBe(hashDetectorSources(lf));
  });

  it("cannot be collided by re-splitting the same concatenated text", () => {
    const split = [
      { path: "a.ts", source: "xy" },
      { path: "b.ts", source: "z" },
    ];
    const other = [
      { path: "a.ts", source: "x" },
      { path: "b.ts", source: "yz" },
    ];
    expect(hashDetectorSources(split)).not.toBe(hashDetectorSources(other));
  });

  it("is stable across calls — nothing time- or run-derived is mixed in", () => {
    expect(hashDetectorSources(lf)).toBe(hashDetectorSources(lf));
  });
});

describe("the detector source manifest", () => {
  it("covers the module the re-acquire ladder and identity gate live in", async () => {
    const paths = await listDetectorSourcePaths();
    expect(paths).toContain("pipeline/tracking/climberTracker.ts");
  });

  it("covers the detector entry that drives the ladder", async () => {
    const paths = await listDetectorSourcePaths();
    expect(paths).toContain("hooks/useVideoProcessor.ts");
  });

  it("covers every explicitly listed file and each walked directory", async () => {
    const paths = await listDetectorSourcePaths();
    for (const file of DETECTOR_SOURCE_FILES) expect(paths).toContain(file);
    for (const dir of DETECTOR_SOURCE_DIRS) {
      expect(paths.some((p) => p.startsWith(`${dir}/`))).toBe(true);
    }
  });

  it("excludes modules that cannot alter a keypoint", async () => {
    const paths = await listDetectorSourcePaths();
    expect(paths).not.toContain("pipeline/matching/orbDetector.ts");
    expect(paths).not.toContain("pipeline/analysis/frameAnalyzer.ts");
  });

  it("lists each path once, sorted by codepoint, with no absolute paths", async () => {
    const paths = await listDetectorSourcePaths();
    expect(new Set(paths).size).toBe(paths.length);
    expect([...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(paths);
    for (const p of paths) {
      expect(p.startsWith("/")).toBe(false);
      expect(p).not.toMatch(/^[A-Za-z]:/);
      expect(p).not.toContain("\\");
    }
  });
});

describe("computeDetectorCodeHash", () => {
  it("returns the same digest for two checkouts differing only in path and line endings", async () => {
    const roots: string[] = [];
    try {
      for (const eol of ["\n", "\r\n"]) {
        const root = await mkdtemp(path.join(tmpdir(), "detector-hash-"));
        roots.push(root);
        for (const dir of DETECTOR_SOURCE_DIRS) {
          await mkdir(path.join(root, dir), { recursive: true });
          await writeFile(path.join(root, dir, "mod.ts"), LF.replace(/\n/g, eol), "utf8");
        }
        for (const file of DETECTOR_SOURCE_FILES) {
          await mkdir(path.join(root, path.dirname(file)), { recursive: true });
          await writeFile(path.join(root, file), LF.replace(/\n/g, eol), "utf8");
        }
      }
      const [lf, crlf] = await Promise.all(roots.map((r) => computeDetectorCodeHash(r)));
      expect(crlf).toBe(lf);
      // Different temp directories, identical content — an absolute path or a
      // build id leaking into the digest would show up right here.
      expect(roots[0]).not.toBe(roots[1]);
    } finally {
      await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
    }
  });

  it("hashes the working tree without throwing", async () => {
    await expect(computeDetectorCodeHash()).resolves.toMatch(
      new RegExp(`^[0-9a-f]{${DETECTOR_CODE_HASH_LENGTH}}$`),
    );
  });
});
