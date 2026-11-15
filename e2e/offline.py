"""The NASA photo basemaps work with NASA's servers unreachable:

    cd sars-frontend && uv run --with playwright python -I e2e/offline.py [http://localhost:5173]

Blocks every request to gibs.earthdata.nasa.gov, then opens each event on the HLS and MODIS
basemaps and checks that the before and after panes are filled from the backend's copy
(`pipeline tiles`). Fails if a visible tile is missing or any tile came from GIBS.
"""

import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright


def pick(pg, event_id):
    """Open the event dropdown and choose an event by id."""
    pg.get_by_role("combobox", name="Choose an event").or_(
        pg.locator("[aria-label='Choose an event']")
    ).first.click()
    pg.wait_for_timeout(400)
    pg.locator(f"[data-event='{event_id}']").click()


URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
API = "http://localhost:8000/api/v1"

PANES = """() => ['tilesBefore', 'tilesAfter'].map(n => {
  const p = document.querySelector('.leaflet-' + n + '-pane');
  const tiles = p ? [...p.querySelectorAll('img.leaflet-tile')] : [];
  return { pane: n, tiles: tiles.length, loaded: tiles.filter(i => i.complete && i.naturalWidth > 0).length,
           local: tiles.filter(i => i.src.includes('/files/tiles/')).length };
})"""

failures: list[str] = []
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    blocked: list[str] = []
    pg.route("**/gibs.earthdata.nasa.gov/**", lambda r: (blocked.append(r.request.url), r.abort()))
    pg.goto(URL)
    pg.wait_for_timeout(6000)
    for ev in json.load(urllib.request.urlopen(f"{API}/events")):
        pick(pg, ev["id"])
        pg.wait_for_timeout(5000)
        for basemap in ("hls", "modis"):
            pg.get_by_label("Basemap").select_option(basemap)
            pg.wait_for_timeout(6000)
            for pane in pg.evaluate(PANES):
                ok = pane["tiles"] > 0 and pane["loaded"] == pane["tiles"] == pane["local"]
                print(
                    f"{ev['id']:16s} {basemap:5s} {pane['pane']:11s} {pane['loaded']}/{pane['tiles']} tiles loaded, {pane['local']} from the local copy {'OK' if ok else 'FAIL'}"
                )
                if not ok:
                    failures.append(f"{ev['id']} {basemap} {pane['pane']}")
        pg.get_by_label("Basemap").select_option("gray")
    print("requests that tried GIBS (blocked):", len(blocked))
    b.close()
print("RESULT:", "PASS" if not failures and not blocked else f"FAIL {failures}")
sys.exit(1 if failures or blocked else 0)
