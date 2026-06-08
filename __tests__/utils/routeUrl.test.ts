import { describe, expect, it } from "vitest";
import { buildRouteUrl } from "@/utils/routeUrl";

const ctx = { state: "CO", area: "RMNP", route: "Slab" };

describe("buildRouteUrl", () => {
  it("builds the per-user route path with no query when no keys/mode", () => {
    expect(buildRouteUrl("user1", ctx)).toBe("/route/user1/CO/RMNP/Slab");
  });

  it("encodes path segments", () => {
    expect(
      buildRouteUrl("user1", { state: "CO", area: "Clear Creek", route: "Slab/Master" }),
    ).toBe("/route/user1/CO/Clear%20Creek/Slab%2FMaster");
  });

  it("emits a single key", () => {
    expect(buildRouteUrl("u", ctx, { keys: "RouteData/u/x.json" })).toBe(
      "/route/u/CO/RMNP/Slab?keys=RouteData%2Fu%2Fx.json",
    );
  });

  it("joins multiple keys into one encoded csv", () => {
    expect(buildRouteUrl("u", ctx, { keys: ["a", "b"] })).toBe(
      "/route/u/CO/RMNP/Slab?keys=a%2Cb",
    );
  });

  it("emits mode only when supplied", () => {
    expect(buildRouteUrl("u", ctx, { keys: "a" })).not.toContain("mode=");
    expect(buildRouteUrl("u", ctx, { keys: "a", mode: "single" })).toBe(
      "/route/u/CO/RMNP/Slab?keys=a&mode=single",
    );
    expect(buildRouteUrl("u", ctx, { keys: ["a", "b"], mode: "multiple" })).toBe(
      "/route/u/CO/RMNP/Slab?keys=a%2Cb&mode=multiple",
    );
  });

  it("omits empty key csv", () => {
    expect(buildRouteUrl("u", ctx, { keys: [] })).toBe("/route/u/CO/RMNP/Slab");
    expect(buildRouteUrl("u", ctx, { keys: "" })).toBe("/route/u/CO/RMNP/Slab");
  });
});
