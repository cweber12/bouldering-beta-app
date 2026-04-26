Scaffold a new pipeline module. Ask me for:
- The module name (e.g. `frameNormalizer`)
- The exported function signatures (name, parameters, return type)

Then create both files:

## 1. `pipeline/{name}.ts`

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export function myFunction(cv: CV, ...): ReturnType {
  const mat = new cv.Mat(...);
  try {
    // implementation
  } finally {
    mat.delete();
  }
}
```

Rules to follow:
- Zero React imports
- `type CV = any` alias at the top (with eslint-disable comment)
- Every exported function takes `cv: CV` as its first parameter
- All functions are synchronous — no `async`, no `Promise`
- Every `cv.Mat` (or other OpenCV object) allocation is freed in a `finally` block
- No `any` usage outside the `type CV = any` declaration

## 2. `__tests__/pipeline/{name}.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { myFunction } from "@/pipeline/{name}";

// Mock any other pipeline/ imports at the module boundary
vi.mock("@/pipeline/otherModule", () => ({ ... }));

describe("{name}", () => {
  let mockCv: Record<string, unknown>;

  beforeEach(() => {
    mockCv = {
      Mat: vi.fn().mockReturnValue({ delete: vi.fn() }),
      // add other cv methods used
    };
  });

  it("...", () => {
    // Use plain object cast for ImageData: { data, width, height, colorSpace } as ImageData
  });
});
```

After creating both files, run `npx tsc --noEmit` and `npx vitest run __tests__/pipeline/{name}.test.ts` to verify they pass.
