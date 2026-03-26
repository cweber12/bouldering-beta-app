import { describe, it, expect, vi } from "vitest";
import { matDelete } from "@/utils/cvHelpers";

describe("matDelete", () => {
  it("calls .delete() on a valid Mat object", () => {
    const mat = { delete: vi.fn() };
    matDelete(mat);
    expect(mat.delete).toHaveBeenCalledOnce();
  });

  it("does not throw when passed null", () => {
    expect(() => matDelete(null)).not.toThrow();
  });

  it("does not throw when passed undefined", () => {
    expect(() => matDelete(undefined)).not.toThrow();
  });

  it("does not throw when .delete() itself throws (already freed)", () => {
    const mat = {
      delete: vi.fn().mockImplementation(() => {
        throw new Error("Mat already deleted");
      }),
    };
    expect(() => matDelete(mat)).not.toThrow();
  });

  it("does not call .delete() on null (no-op)", () => {
    // Verify the null guard short-circuits correctly.
    const mat = { delete: vi.fn() };
    matDelete(null);
    expect(mat.delete).not.toHaveBeenCalled();
  });
});
