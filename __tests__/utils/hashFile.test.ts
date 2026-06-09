import { describe, it, expect, vi } from "vitest";
import { hashFile } from "@/utils/hashFile";

// Known SHA-256 of the bytes "hello" (lowercase hex).
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

describe("hashFile", () => {
  it("computes the SHA-256 hex digest of a file's bytes", async () => {
    const file = new File(["hello"], "v.webm", { type: "video/webm" });
    expect(await hashFile(file)).toBe(HELLO_SHA256);
  });

  it("returns the same cached promise for the same File instance", async () => {
    const file = new File(["hello"], "v.webm", { type: "video/webm" });
    const spy = vi.spyOn(file, "arrayBuffer");
    await hashFile(file);
    await hashFile(file);
    // Second call resolves from the cache without re-reading the bytes.
    expect(spy).toHaveBeenCalledOnce();
  });

  it("hashes differing content to differing digests", async () => {
    const a = new File(["hello"], "a.webm");
    const b = new File(["world"], "b.webm");
    expect(await hashFile(a)).not.toBe(await hashFile(b));
  });
});
