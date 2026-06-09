# Dev-local detection diagnostics, not server telemetry

To analyse what drives pose/ORB detection quality and steer future tuning, every
scan and every route-photo match emits a structured diagnostics record. These
records are written to a **gitignored local JSONL file on the developer's
machine** via a dev-only `POST /api/diagnostics` route (guarded by
`NODE_ENV === "development"`), and rendered live in a dev-only `<DiagnosticsPanel>`
on **StepViewLandmarks** and **StepMatchRoutePhoto**. They are **not** collected
server-side and never run for real users.

The records are **self-contained** — each carries the full input conditions, the
resolved detection config, an `appVersion` (git SHA), and the result, keyed by
SHA-256 content hashes of the video and image — so trend analysis needs no join
back to the pose/ORB artifacts, and survives the team's own tuning changes (you
can always tell whether a shift came from a condition or from a config change).
See **Scan Diagnostics**, **Match Diagnostics**, **Reference Frame Metadata** in
CONTEXT.md.

## Considered options

- **Server-collected telemetry** (the obvious default) was rejected: it requires
  a collection endpoint, storage, and a privacy/consent surface for user video
  conditions, in exchange for prod/real-user coverage we do not yet need. The
  questions we want to answer ("are backlit climber crops correlated with low
  keypoint counts?") are answerable from the developer's own scans during tuning.
- **Browser-side persistence** (File System Access API / downloads) was rejected
  as the write mechanism: clunky per-scan prompts or manual file juggling. A
  dev-only API route appending JSONL is the natural bridge from the browser
  (where the data is produced) to disk, and no-ops harmlessly in production where
  the filesystem is read-only.

## Consequences

- One diagnostic field deliberately lives in **S3, not locally**: **Reference
  Frame Metadata** rides on the Run artifact alongside its ORB features, because
  a Run is matched to *many* images over time and each later **Match Diagnostics**
  record (written locally at match time) must recover the reference frame's
  conditions to correlate them against the matched image. Everything else is
  local.
- The diagnostics path is the **only reason** `computeHomography` carries an
  optional `stats` out-param (`HomographyStats` with `failureReason`), populated
  on every return path including rejections — so a failed match is a labelled
  data point rather than an indistinguishable `null`.
- Because collection is dev-local, there is **no real-user data**. If product
  ever needs aggregate quality metrics across the install base, this is a
  rebuild, not an extension — the records and the JSONL tooling assume a single
  trusted machine.
