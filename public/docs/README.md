# Docs page screenshots

The **How it works** section in `app/docs/page.tsx` references the images below.
Save each screenshot into this folder with the exact filename. Any aspect ratio
works — the docs `Figure` frame letterboxes to 16:9.

| Filename             | Stage                | What it should show                                                        |
|----------------------|----------------------|----------------------------------------------------------------------------|
| `skeleton-holds.png` | Pose estimation      | Video frame with the green skeleton + blue/orange hold rings               |
| `detection-crops.png`| Detection framing    | Scan step with the nested outer Route box + inner Climber box              |
| `orb-features.png`   | Feature extraction   | Video frame with red ORB feature points across the wall                    |
| `route-photo.png`    | Route-photo matching | The clean uploaded route photo (no overlay)                                |
| `pose-overlay.png`   | Reprojection & overlay | Route photo with the reprojected skeleton + hold rings (final export)     |
