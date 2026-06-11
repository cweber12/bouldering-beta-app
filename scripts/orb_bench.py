"""Drive /dev/orb-bench over real video+photo pairs and scrape the A/B table.

Throwaway diagnostic harness for the asymmetric-preprocessing fix (#1). Not part
of the app. Reports legacy (A) vs symmetric (B) match count / inliers / ratio /
homography per case, repeated to average out RANSAC non-determinism.
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/dev/orb-bench"
RUNS = 3

CASES = [
    ("Mandala (expected BAD)",
     r"C:\Users\coled\OneDrive\Desktop\route_videos\The_Mandala.mp4",
     r"C:\Users\coled\OneDrive\Desktop\route_photos\MandalaThe.jpg"),
    ("Maze of Death #2 (expected GOOD)",
     r"C:\Users\coled\OneDrive\Desktop\route_videos\Bishop_Bouldering__A_Maze_of_Death__V12_ (1).mp4",
     r"C:\Users\coled\OneDrive\Desktop\route_photos\MazeOfDeath2.jpg"),
    ("Maze of Death #3 (expected GOOD)",
     r"C:\Users\coled\OneDrive\Desktop\route_videos\Bishop_Bouldering__A_Maze_of_Death__V12_ (1).mp4",
     r"C:\Users\coled\OneDrive\Desktop\route_photos\MazeOfDeath3.jpg"),
]


def launch(p):
    # System Chrome ships proprietary H.264; bundled Chromium does not.
    for kw in ({"channel": "chrome"}, {}):
        try:
            return p.chromium.launch(headless=True, **kw)
        except Exception as e:  # noqa: BLE001
            print(f"  launch {kw or 'chromium'} failed: {e}")
    raise SystemExit("no browser available")


def scrape_rows(page):
    rows = []
    for tr in page.locator("tbody tr").all():
        tds = [td.inner_text().strip() for td in tr.locator("td").all()]
        rows.append(tds)
    return rows


def run_case(page, name, ref, query):
    print(f"\n=== {name} ===")
    page.goto(BASE)
    page.wait_for_load_state("networkidle")

    inputs = page.locator('input[type=file]')
    inputs.nth(0).set_input_files(ref)
    inputs.nth(1).set_input_files(query)

    btn = page.locator("main button")  # the only button inside <main>
    settled = "() => { const b = document.querySelector('main button'); return b && !b.disabled; }"
    # Wait until OpenCV finished loading (button leaves the disabled state).
    page.wait_for_function(settled, timeout=60000)

    for i in range(RUNS):
        btn.click()
        # running → disabled true then false again; wait for it to settle.
        page.wait_for_function(settled, timeout=120000)
        err = page.locator("p.text-danger")
        if err.count() > 0:
            print(f"  run {i+1}: ERROR: {err.first.inner_text().strip()}")
            continue
        dims = page.locator("section div.text-fg-muted").first
        if i == 0 and dims.count() > 0:
            print(f"  {dims.inner_text().strip()}")
        for r in scrape_rows(page):
            # [variant, qkp, matches, inliers, ratio, H?, extract, match]
            print(f"  run {i+1}: {r[0]:30s} matches={r[2]:>4} inliers={r[3]:>4} "
                  f"ratio={r[4]:>4} H={r[5]:>14} ({r[6]}/{r[7]})")


def main():
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page()
        logs = []
        page.on("console", lambda m: logs.append(m.text) if m.type == "error" else None)
        for name, ref, query in CASES:
            try:
                run_case(page, name, ref, query)
            except Exception as e:  # noqa: BLE001
                print(f"  case failed: {e}")
        browser.close()
        if logs:
            print("\n=== console errors ===")
            for l in logs[:20]:
                print(" ", l)


if __name__ == "__main__":
    sys.exit(main())
