Scaffold a new React hook. Ask me for:
- The hook name (e.g. `useFrameNormalizer`)
- Which pipeline/ functions it wraps
- What state/status it should expose

Then create both files:

## 1. `hooks/{name}.ts` (use `.tsx` only if the hook returns JSX)

```typescript
import { useState, useCallback } from "react";
import { useOpenCV } from "@/hooks/useOpenCV";
// import pipeline functions here

type Status = "idle" | "processing" | "ready" | "failed";

export function useMyHook() {
  const { cv, ready: cvReady } = useOpenCV();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (...) => {
    if (!cvReady || !cv) return;
    setStatus("processing");
    try {
      // call pipeline/ functions — never allocate cv.Mat directly here
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("failed");
    }
  }, [cv, cvReady]);

  return { status, error, run };
}
```

Rules to follow:
- Never allocate `cv.Mat` or other OpenCV objects directly — only call `pipeline/` functions
- Never read `cv` from `window` or `globalThis` — always receive it from `useOpenCV()`
- Expose a typed `status: "idle" | "processing" | "ready" | "failed"`
- `imageFile` or other File objects must be received as parameters, not stored in the hook

## 2. `__tests__/hooks/{name}.test.ts`

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useMyHook } from "@/hooks/{name}";

// Mock pipeline dependencies at the module boundary
vi.mock("@/pipeline/someModule", () => ({ someFunction: vi.fn() }));

// Mock useOpenCV
vi.mock("@/hooks/useOpenCV", () => ({
  useOpenCV: () => ({ cv: {}, ready: true }),
}));

describe("useMyHook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts in idle state", () => {
    const { result } = renderHook(() => useMyHook());
    expect(result.current.status).toBe("idle");
  });
});
```

After creating both files, run `npx tsc --noEmit` and `npx vitest run __tests__/hooks/{name}.test.ts` to verify they pass.
