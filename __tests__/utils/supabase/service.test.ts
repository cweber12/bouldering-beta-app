import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// We need to test createServiceClient with different env var combinations.
// Since the module caches _serviceClient as a singleton, we re-import after
// each test to reset it.
// ---------------------------------------------------------------------------

// Mock @supabase/supabase-js createClient to return a dummy client.
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ __mockClient: true })),
}));

describe("createServiceClient", () => {
  const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env vars.
    if (origUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
    else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (origKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (origAnon !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origAnon;
    else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";

    const { createServiceClient } = await import("@/utils/supabase/service");
    expect(() => createServiceClient()).toThrow("SUPABASE_SERVICE_ROLE_KEY is not configured");
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "some-key";

    const { createServiceClient } = await import("@/utils/supabase/service");
    expect(() => createServiceClient()).toThrow("SUPABASE_SERVICE_ROLE_KEY is not configured");
  });

  it("creates a client when env vars are present", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    // Encode a fake JWT payload with ref "test"
    const payload = Buffer.from(JSON.stringify({ ref: "test", role: "service_role" })).toString("base64");
    process.env.SUPABASE_SERVICE_ROLE_KEY = `header.${payload}.sig`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = `header.${payload}.sig`;

    const { createServiceClient } = await import("@/utils/supabase/service");
    const client = createServiceClient();
    expect(client).toBeTruthy();
  });

  it("logs a warning when service key ref mismatches anon key ref", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    const servicePayload = Buffer.from(JSON.stringify({ ref: "project-a" })).toString("base64");
    const anonPayload = Buffer.from(JSON.stringify({ ref: "project-b" })).toString("base64");
    process.env.SUPABASE_SERVICE_ROLE_KEY = `header.${servicePayload}.sig`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = `header.${anonPayload}.sig`;

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { createServiceClient } = await import("@/utils/supabase/service");
    createServiceClient();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("does not match"),
    );
    consoleSpy.mockRestore();
  });

  it("does not warn when refs match", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    const payload = Buffer.from(JSON.stringify({ ref: "same-project" })).toString("base64");
    process.env.SUPABASE_SERVICE_ROLE_KEY = `header.${payload}.sig`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = `header.${payload}.sig`;

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { createServiceClient } = await import("@/utils/supabase/service");
    createServiceClient();

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
