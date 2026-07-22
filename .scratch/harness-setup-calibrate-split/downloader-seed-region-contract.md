# Downloader task: seed the ViTPose job from `seed_tap` + `seed_region`

Instructions for an agent working in the **downloader repository** (the separate
program exposing `POST /api/vitpose`, see
`.scratch/ground-truth-detection-eval/downloader-vitpose-contract.md`). This is an
amendment to that contract, not a new endpoint. The beta-scanner side is built
(branch `feat/harness-vitpose-seed-region`, harness-setup-calibrate-split issue 02).

## Why

beta-scanner split the single Climber tap into two. The in-hash **analysis tap**
seeds MediaPipe during Analyze; a new off-hash **Seed tap** seeds *this* ViTPose
job. The Seed tap is authored in a later, unambiguous frame the tracker can track
backward from, and it is deliberately **independent of the Climber Crop** — so the
crop can no longer gate the seed. beta-scanner now derives a small acquisition box
around the Seed tap and sends it as `seed_region`; the downloader gates the seed
against that box instead of `climber_crop`. This lets the author seed from anywhere
the climber is clearest without redrawing the crop, and (because the Seed tap is
excluded from `setup_hash`) re-seeding never re-pairs prior detection runs.

## Request body change

`POST /api/vitpose` now carries two new fields; the legacy ones remain for a
transition period so an un-migrated downloader keeps working:

```jsonc
{
  "video_path":   "analysis/route-x/vid_1/vid_1.mp4",
  "route_folder": "route-x",
  "video_key":    "vid_1",

  // NEW — the seed contract of record:
  "seed_tap":    { "x": 0.5, "y": 0.4, "t": 2.33 } | null, // Seed tap, video-normalized [0,1]; t = tapped frame time (s)
  "seed_region": { "x": 0.35, "y": 0.25, "w": 0.3, "h": 0.3 }, // acquisition box around the Seed tap, fractions [0,1]

  // LEGACY (transition) — `climber_point` is an alias of `seed_tap`; the crops ride
  // along for parity but MUST NOT gate the seed once you honor seed_region:
  "climber_point": { "x": 0.5, "y": 0.4, "t": 2.33 } | null, // == seed_tap
  "climber_crop":  { "x": 0.05, "y": 0.05, "w": 0.9, "h": 0.9 }, // no longer the seed gate
  "wall_crop":     { "x": 0.05, "y": 0.05, "w": 0.9, "h": 0.9 }, // ignore for pose

  "panning": false,
  "frames":  [ { "timestamp": 0.0 }, { "timestamp": 0.1 }, ... ]
}
```

## What to change in the job

Only the **Climber-track selection** step (step 3 of the base contract) changes:

- Select the Climber track using `seed_tap`: pick the track whose box contains / is
  nearest the tap on the frame nearest `seed_tap.t` (use `t` — it is the frame the
  climber is clearest in), then follow that track id both forward and backward.
- Gate the seed against **`seed_region`**, not `climber_crop`: the candidate must
  fall within `seed_region` (you may keep a small expansion band like the old
  `_CROP_GATE_EXPAND`, applied to `seed_region` now). Because `seed_region` is
  centered on the Seed tap, a valid tap is always inside it — the "tap outside the
  crop" failure mode disappears.
- If `seed_tap` is null, `seed_region` is the full frame `{0,0,1,1}`: fall back to
  the largest / most-central person, as before.
- Everything else — timestamp echo, normalized coords, the 13 core joint names,
  confidence, empty-vs-present, idempotent overwrite — is **unchanged** from the
  base contract.

During the transition you may read `climber_point` if `seed_tap` is absent; once
migrated, prefer `seed_tap` + `seed_region` and ignore `climber_crop` for seeding.

## Validation / behaviour target

- A Seed tap placed on the climber in a clear later frame seeds the correct track
  even when the climber is outside the Climber Crop at that moment.
- `seed_found: false` is still reported (in `vitpose.status.json` `seedDebug`) when
  no track matches the Seed tap, so beta-scanner can point the author at a re-tap.

## Integration checklist

- [ ] Downloader: gate the seed on `seed_region`; select the track from `seed_tap`
      (using `seed_tap.t`); full-frame fallback when null.
- [x] beta-scanner: `ViTPoseRequest` carries `seed_tap` + `seed_region`; proxy
      forwards `seed_tap`/`seed_region` (+ legacy `climber_point` alias);
      `deriveSeedRegion` builds the box (branch `feat/harness-vitpose-seed-region`).
- [ ] End-to-end: seed from a later frame with the climber outside the Climber Crop;
      confirm `vitpose.json` poses the right track and Ground Truth review opens.
- [ ] Once migrated, drop the legacy `climber_point`/`climber_crop` seed path.
