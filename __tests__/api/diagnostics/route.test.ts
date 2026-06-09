import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks — must be set up BEFORE dynamic imports
// ---------------------------------------------------------------------------

const mockAppendFile: Mock = vi.fn();
const mockMkdir: Mock = vi.fn();

vi.mock("node:fs/promises", () => {
  const appendFile = (...args: unknown[]) => mockAppendFile(...args);
  const mkdir = (...args: unknown[]) => mockMkdir(...args);
  return { appendFile, mkdir, default: { appendFile, mkdir } };
});

const { POST } = await import("@/app/api/diagnostics/route");

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  mockAppendFile.mockReset().mockResolvedValue(undefined);
  mockMkdir.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/diagnostics", () => {
  it("404s outside development and writes nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(makeRequest({ recordType: "scan" }));
    expect(res.status).toBe(404);
    expect(mockAppendFile).not.toHaveBeenCalled();
  });

  it("appends a scan record to scans.jsonl in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const record = { recordType: "scan", scanId: "run-1" };
    const res = await POST(makeRequest(record));

    expect(res.status).toBe(200);
    expect(mockMkdir).toHaveBeenCalledOnce();
    expect(mockAppendFile).toHaveBeenCalledOnce();
    const [filePath, line] = mockAppendFile.mock.calls[0];
    expect(String(filePath)).toMatch(/scans\.jsonl$/);
    expect(line).toBe(JSON.stringify(record) + "\n");
  });

  it("routes match records to matches.jsonl", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await POST(makeRequest({ recordType: "match" }));
    expect(String(mockAppendFile.mock.calls[0][0])).toMatch(/matches\.jsonl$/);
  });

  it("400s on an unknown recordType", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await POST(makeRequest({ recordType: "bogus" }));
    expect(res.status).toBe(400);
    expect(mockAppendFile).not.toHaveBeenCalled();
  });

  it("400s on invalid JSON", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await POST({
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as NextRequest);
    expect(res.status).toBe(400);
  });
});
