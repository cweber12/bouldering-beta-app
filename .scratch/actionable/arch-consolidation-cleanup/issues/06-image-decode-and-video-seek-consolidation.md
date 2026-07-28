# Consolidate image decoding and video seeking

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-consolidation-cleanup/PRD.md`

## Blocked by

Nothing. Independent of every other issue in this PRD.

## What to build

Two related patterns are hand-rolled repeatedly, and each copy is a chance to forget one of the
details that make it correct.

**Image → `ImageData` decoding.** Three named implementations plus two inline repeats:

- `hooks/useImageMatcher.ts:495` `loadImageAsImageData(file)`
- `app/dev/orb-bench/page.tsx:67` `loadImageData(file)` — same structure, same `capToPixelBudget`
  cap, different error strings
- `components/scan/process-flow/StepSetDetection.tsx:31` `captureFrame(video)` — the video-frame
  variant of the same canvas dance
- `utils/backdropLuma.ts:52` and `hooks/useVideoProcessor.ts:777` repeat
  `getContext("2d", { willReadFrequently: true })` followed by `getImageData` inline

Build one decoder covering both sources (a `File`/`Blob` and an `HTMLVideoElement` frame). The
`willReadFrequently` hint and the pixel-budget cap must be applied consistently — those are
performance-critical and currently depend on which copy a caller happened to reach for. Error
strings differ between copies; keep whatever each call site surfaces to the user, or unify them
deliberately and say so.

`hooks/useVideoProcessor.ts` is owned by `scan-pipeline-isolation-testability` — **do not
restructure it here.** Substituting its inline block for a call to the shared decoder is fine if
it is a clean one-line swap; if it is entangled, leave it and note it in `## Comments`.

**Video seek and metadata.** `utils/videoSeek.ts` already exists and already provides `seekVideo`
with `SeekAbortedError` and `SeekTimeoutError`, and `utils/probeVideoMeta.ts` handles metadata —
but hand-rolled `seeked` / `loadedmetadata` listeners still live at `app/dev/orb-bench/page.tsx:129`,
`components/dev/FrameStage.tsx:143`, `components/skeleton/FramePlayer.tsx:376` and `:625`, and
`hooks/useDetectionThumbnails.ts:69` and `:105`.

Route each through `utils/videoSeek.ts`. This is the one consolidation where the canonical
implementation is **stricter** than the copies: it adds abort and timeout semantics the raw
listeners lack. That is an improvement, but it means a seek that previously hung forever now
rejects — check each call site handles the rejection rather than swallowing it, and verify the
timeout is generous enough for the largest corpus videos before assuming parity.

## Acceptance criteria

- [ ] One decoder handles both `File`/`Blob` and video-frame sources, applying the
      `willReadFrequently` hint and the pixel-budget cap in both paths.
- [ ] A characterization test covers both source types, the pixel-budget cap boundary, and the
      decode-failure path, and passes before any call site migrates.
- [ ] `loadImageAsImageData`, `loadImageData`, and `captureFrame` are gone; their call sites use
      the shared decoder.
- [ ] `utils/backdropLuma.ts`'s inline `getImageData` block uses the shared decoder.
- [ ] `hooks/useVideoProcessor.ts` is either a clean one-line swap or left untouched with the
      reason in `## Comments` — it is not restructured here.
- [ ] The six hand-rolled seek/metadata listener sites use `utils/videoSeek.ts` or
      `utils/probeVideoMeta.ts`.
- [ ] Each migrated seek site handles `SeekAbortedError` and `SeekTimeoutError` rather than
      swallowing them.
- [ ] The seek timeout is verified adequate for the largest corpus video, with the figure recorded
      in `## Comments`.
- [ ] `npx tsc --noEmit`, `npx eslint .`, and **full** `npx vitest run` pass.
- [ ] Manual smoke: `npm run dev`, upload a route photo in the scan flow, step frames in
      `/dev/harness`, and scrub a `FramePlayer` transport. All three still work.

## Comments

- This is the issue in the PRD with the most genuine behaviour-change risk, because
  `utils/videoSeek.ts` is stricter than what it replaces. The manual smoke pass matters here more
  than anywhere else in this PRD.
- If the timeout turns out to be too tight for real corpus videos, raise it in `utils/videoSeek.ts`
  as part of this issue rather than leaving call sites on hand-rolled listeners.
