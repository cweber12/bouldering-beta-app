# Exposure-compensate flagged search regions

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/pose-detection-loss-recovery/PRD.md`
- Handoff: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements.md` §4
- Decision read: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements-round-2.md` §1

## What to build

Give MediaPipe a better-exposed crop on the frames where lighting is the
plausible cause of failure. Failure lives in the condition flags, not the
medians: on the 07-24 corpus, missing frames are `isUnderexposed` 7.9% and
`isBacklit` 5.6% of the time against 0.8% / 0.3% for accepted — roughly a 10×
odds shift. Absolute luma barely moves by status (accepted 119.8 vs missing
120.0), so the flags carry the signal and the levels do not.

**The ceiling is now measured, and it is small.** The round-2 read found only
**10.3% of truth-present no-candidates misses** carry a fired condition flag —
so exposure explains a minority of the dominant miss class, and the recoverable
mass lives in issue 03's ladder, not here. This issue stays last in the code
sequence and must not delay 03–04. (The pre-02 framing that flip-rejected
frames were underexposed 10.0% of the time is also largely moot: issue 02 cut
`flipRejected` from 7.0% to ~1.5%, so the flip lane no longer carries enough
volume to motivate this change on its own.)

Add a colour-preserving compensation to `pipeline/analysis/framePreprocessor.ts`
and apply it in `detectClimber` to the crop drawn on `cropCanvas`, **only** when
the region's `FrameAnalysis` raises `isUnderexposed`, `isBacklit`, or
`isLowContrast`. Ship it behind a `ProcessingOptions` toggle so dev Analyze can
A/B it against an uncompensated run before any user-facing change.

## The constraint that decides the implementation

`applyPosePreprocessing` already exists and must not be reused. It converts the
crop to grayscale and equalises it, which blinded MediaPipe's RGB-trained model
and produced **zero detections on every frame `analyzeFrame` flagged** — a
data-dependent total failure documented in the comment at the top of
`detectClimber`. The handoff's suggestion of "histogram equalization" is that
exact operation.

The new function must therefore keep chroma: gamma correction applied across RGB,
or CLAHE on the luma channel with chroma untouched. `analyzeFrame` already
computes a `suggestedGamma` sized to the severity of the backlight or
underexposure — prefer driving the correction from it over inventing a second
severity model.

## Acceptance criteria

- [ ] A new exported function in `pipeline/analysis/framePreprocessor.ts` applies
      colour-preserving exposure compensation to a canvas region, frees every
      OpenCV allocation in a `finally`, and takes `cv` as its first argument.
- [ ] The output retains chroma — a unit test asserts a saturated input region is
      not returned grayscale (R, G, B do not collapse to equal values).
- [ ] Compensation runs only when the region's analysis raises
      `isUnderexposed`, `isBacklit`, or `isLowContrast`; flag-quiet frames reach
      MediaPipe byte-identical to today.
- [ ] The correction strength is derived from `FrameAnalysis` (e.g.
      `suggestedGamma`), not a fixed constant.
- [ ] Gated behind a `ProcessingOptions` toggle, default off, so user-facing scan
      behavior is unchanged until the A/B says otherwise.
- [ ] Compensation applies on ladder rungs (issue 03) as well as the initial
      crop when their region analysis flags — the rung search is where the
      flagged-miss recovery would actually happen.
- [ ] A processor test proves the compensation path is entered for a flagged
      region and skipped for a clean one, with OpenCV mocked at the module
      boundary.
- [ ] `applyPosePreprocessing` is left unused and gains a comment pointing at
      this function and at why it must not be wired into detection.

## Target metrics (harness re-measures, post-reset baseline only)

- Missing / flipRejected rate on flag-firing frames versus flag-quiet frames —
  the odds ratio should compress toward 1. Read from
  `eval_attempt_funnel_flags.csv`, which carries the per-run distribution beside
  each pooled rate.
- Share of truth-present no-candidates misses with fired flags — 10.3% on the
  02-behavior read; this bounds the win and is the honest denominator for it.
- The old `adverse-conditions` miss share (5.4%) is no longer the instrument:
  under evaluation schema v13 that bucket survives only on records where neither
  authored `missReason` nor a `candidateCount` derivation exists, so it will
  shrink for classification reasons regardless of this change. Judge this issue
  on the flag-conditional rates above instead.

## Comments

- Sits last in the code sequence for a reason: flag-firing frames fail much more
  often, but ~90% of the dominant miss class fires no flag at all, so the
  ceiling on this change is small and now measured. Do not let it delay 03–04.
- Flags cluster hard within a run — one dark video can flood the pooled rate.
  Read the per-run distribution, not just the pooled figure, when judging whether
  this shipped a real improvement.
- Cost: this adds an `analyzeFrame` pass per attempt on the production path,
  which today only runs under `collectDetectorAttempts`. With `inferenceMs`
  landed in issue 06 (now ahead of 03), the A/B run measures this cost directly;
  a cheaper region-luma probe may be enough to decide whether the full analysis
  is worth running.
