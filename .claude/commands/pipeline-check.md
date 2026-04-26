Audit every file in `pipeline/` for rule compliance. Check each of the following and report all violations with file path and line number:

1. **No React imports** — `import React`, `from "react"`, `from 'react'` must not appear
2. **OpenCV cleanup** — every function that calls `new cv.Mat()`, `cv.matFromImageData()`, `cv.matFromArray()`, or any other `cv.*` constructor must have a `finally` block that frees the allocated object
3. **cv as first parameter** — every exported function must have `cv` or a `CV`-typed alias as its first parameter
4. **No async** — no `async` keyword on any function in pipeline files
5. **No loose `any`** — `any` is only permitted in `type CV = any` and `type PoseDetector = any` declarations; flag any other usage

After reporting violations, summarize: X files checked, Y violations found.
