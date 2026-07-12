import { describe, expect, it } from "vitest";
import { buildCompareUrl } from "@/utils/compareUrl";

describe("buildCompareUrl", () => {
  it("encodes a single key", () => {
    expect(buildCompareUrl("RouteData/u/x.json")).toBe("/compare?keys=RouteData%2Fu%2Fx.json");
  });

  it("joins multiple keys into one encoded csv", () => {
    expect(buildCompareUrl(["a", "b"])).toBe("/compare?keys=a%2Cb");
  });

  it("appends route context in order", () => {
    expect(buildCompareUrl("a", { state: "CO", area: "RMNP", route: "Slab" })).toBe(
      "/compare?keys=a&state=CO&area=RMNP&route=Slab",
    );
  });

  it("emits mode only when supplied", () => {
    expect(buildCompareUrl("a")).not.toContain("mode=");
    expect(buildCompareUrl("a", { mode: "single" })).toBe("/compare?keys=a&mode=single");
    expect(buildCompareUrl(["a", "b"], { mode: "multiple" })).toBe(
      "/compare?keys=a%2Cb&mode=multiple",
    );
  });
});
