"""In-browser check of the areas of concentrated change and the swipe, on every event:

    cd sars-frontend && uv run --with playwright python -I e2e/areas.py [http://localhost:5173] [out_dir]

For each event it checks what the page shows, not what the API says it should show:
  - markers on the map = rows in the list = areas in the API, same numbers;
  - under every marker the change image is coloured (read from the PNG the page loaded);
  - every area has its outline drawn as a map line (halo + line);
  - every marker is visible: on screen, on the after side of the divider, not covered;
  - the swipe never goes under the sidebar: at every position the knob and any visible date chip
    stay clear of it;
  - clicking a row zooms the map onto that area, clear of the panels and on the after side, and
    the pixel reading names a land change.
Screenshots of each event (overview) and each area (zoomed) go to out_dir.
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
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp"
API = "http://localhost:8000/api/v1"
LAND_READS = ("darker", "double bounce", "hh and hv alike", "brighter")

SAMPLE = """async ([src, bounds, points]) => {
  const img = new Image(); img.crossOrigin = 'anonymous'; img.src = src; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const [[s, w], [n, e]] = bounds;
  return points.map(([lat, lon]) => {
    const x = Math.floor((lon - w) / (e - w) * img.width), y = Math.floor((n - lat) / (n - s) * img.height);
    const d = g.getImageData(Math.max(0, x - 1), Math.max(0, y - 1), 3, 3).data;
    let hit = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) hit++;
    return hit;
  });
}"""

VISIBLE = """() => {
  const knob = document.querySelector('[aria-label="Swipe between before and after"]').getBoundingClientRect();
  const divider = knob.left + knob.width / 2;
  return [...document.querySelectorAll('.region-badge')].map(el => {
    const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { n: +el.textContent, x, y, divider, covered: !(top === el || el.contains(top)),
             onscreen: x > 0 && y > 0 && x < innerWidth && y < innerHeight };
  });
}"""

SWIPE_CLEAR = """() => {
  const rect = el => el && el.getBoundingClientRect();
  const hit = (a, b) => a && b && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  const panel = rect(document.querySelector('aside[aria-label="Events and details"]'));
  const knob = rect(document.querySelector('[aria-label="Swipe between before and after"]'));
  const chips = ['chip-before', 'chip-after'].map(id => {
    const wrap = document.querySelector(`[data-testid=${id}]`);
    return { id, shown: +getComputedStyle(wrap).opacity > 0.5, r: rect(wrap.firstElementChild) };
  });
  return {
    knobUnderPanel: hit(knob, panel),
    knobOnScreen: knob.left >= 0 && knob.right <= innerWidth,
    chipsUnderPanel: chips.filter(c => c.shown && hit(c.r, panel)).map(c => c.id),
    chipsOffScreen: chips.filter(c => c.shown && (c.r.left < 0 || c.r.right > innerWidth)).map(c => c.id),
    shown: chips.filter(c => c.shown).map(c => c.id),
  };
}"""

BOX_ON_SCREEN = """(box) => {
  const m = window.__map; const knob = document.querySelector('[aria-label="Swipe between before and after"]').getBoundingClientRect();
  const divider = knob.left + knob.width / 2;
  const panels = [...document.querySelectorAll('aside, [data-testid=probe]')].map(e => (e.closest('.glass') || e).getBoundingClientRect());
  const mapRect = m.getContainer().getBoundingClientRect();
  const a = m.latLngToContainerPoint(box[0]), b = m.latLngToContainerPoint(box[1]);
  const x0 = mapRect.left + Math.min(a.x, b.x), x1 = mapRect.left + Math.max(a.x, b.x);
  const y0 = mapRect.top + Math.min(a.y, b.y), y1 = mapRect.top + Math.max(a.y, b.y);
  const overlap = panels.filter(p => p.width && !(x1 <= p.left || x0 >= p.right || y1 <= p.top || y0 >= p.bottom)).length;
  return { x0, x1, y0, y1, divider, overlap, inView: x0 >= mapRect.left - 1 && x1 <= mapRect.right + 1 && y0 >= mapRect.top - 1 && y1 <= mapRect.bottom + 1 };
}"""

failures: list[str] = []


def fail(msg):
    failures.append(msg)
    print("   FAIL", msg)


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs: list[str] = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
    pg.goto(URL)
    pg.wait_for_timeout(6000)
    events = json.load(urllib.request.urlopen(f"{API}/events"))
    knob = pg.get_by_role("slider", name="Swipe between before and after")
    for ev in events:
        api = json.load(urllib.request.urlopen(f"{API}/events/{ev['id']}"))
        pick(pg, ev["id"])
        pg.wait_for_timeout(6000)
        pg.get_by_role("button", name="Fit the event in view").click()
        pg.wait_for_timeout(1500)
        regs = api["regions"]
        print(
            f"\n== {api['title']}: {len(regs)} areas, coverage {api['area_rule']['coverage_pct']}%"
        )
        n_badges = pg.locator(".region-badge").count()
        n_rows = pg.locator("aside ol li").count()
        if not (n_badges == n_rows == len(regs)):
            fail(f"{ev['id']}: badges {n_badges}, rows {n_rows}, api {len(regs)}")
        pos = pg.evaluate(
            "() => [...document.querySelectorAll('.region-badge')].map(el => el.textContent)"
        )
        if sorted(int(t) for t in pos) != [r["n"] for r in regs]:
            fail(f"{ev['id']}: badge numbers {pos}")
        src = f"http://localhost:8000{api['layers']['change']}"
        hits = pg.evaluate(SAMPLE, [src, api["bounds"], [[r["lat"], r["lon"]] for r in regs]])
        for r, h in zip(regs, hits):
            if h == 0:
                fail(f"{ev['id']}: area {r['n']} marker has no change colour under it")
        paths = pg.locator(".leaflet-areas-pane path").count()
        if paths != 2 * len(regs):
            fail(
                f"{ev['id']}: {paths} outline paths for {len(regs)} areas (expected halo + line each)"
            )
        for v in pg.evaluate(VISIBLE):
            if not v["onscreen"]:
                fail(f"{ev['id']}: area {v['n']} marker off screen")
            elif v["covered"]:
                fail(f"{ev['id']}: area {v['n']} marker covered")
            elif v["x"] < v["divider"]:
                fail(f"{ev['id']}: area {v['n']} marker on the before side (no change shown there)")
        if not regs and "No area stands out" not in pg.locator("aside").first.inner_text():
            fail(f"{ev['id']}: empty state missing")
        pg.screenshot(path=f"{OUT}/areas-{ev['id']}.png")
        # The swipe at every position: never under the panel, chips only where they fit.
        seen = set()
        for key, presses in (("Home", 1), ("ArrowRight", 3), ("ArrowRight", 10), ("End", 1)):
            knob.focus()
            for _ in range(presses):
                pg.keyboard.press(key)
            pg.wait_for_timeout(350)
            c = pg.evaluate(SWIPE_CLEAR)
            seen |= set(c["shown"])
            if c["knobUnderPanel"] or not c["knobOnScreen"]:
                fail(
                    f"{ev['id']}: knob under the panel or off screen at {knob.get_attribute('aria-valuenow')}%"
                )
            if c["chipsUnderPanel"] or c["chipsOffScreen"]:
                fail(
                    f"{ev['id']}: chips {c['chipsUnderPanel'] + c['chipsOffScreen']} under the panel or off screen"
                )
        if seen != {"chip-before", "chip-after"}:
            fail(f"{ev['id']}: date chips never both shown while swiping ({sorted(seen)})")
        knob.focus()
        pg.keyboard.press("Home")
        pg.wait_for_timeout(300)
        for i, r in enumerate(regs):
            pg.locator("aside ol li button").nth(i).click()
            pg.wait_for_timeout(2600)
            on = pg.evaluate(BOX_ON_SCREEN, r["box"])
            if not on["inView"]:
                fail(f"{ev['id']}: area {r['n']} not fully on screen after zoom")
            if on["x0"] < on["divider"] - 2:
                fail(f"{ev['id']}: area {r['n']} partly on the before side after zoom")
            if on["overlap"]:
                fail(f"{ev['id']}: area {r['n']} under a panel after zoom")
            hidden = pg.evaluate("""() => {
              const card = document.querySelector('[data-testid=probe]').closest('.glass').getBoundingClientRect();
              const bar = document.querySelector('[aria-label="Zoom out"]').parentElement.getBoundingClientRect();
              return !(card.bottom <= bar.top || card.top >= bar.bottom || card.right <= bar.left || card.left >= bar.right);
            }""")
            if hidden:
                fail(f"{ev['id']}: pixel reading overlaps the toolbar")
            reads = pg.locator("[data-testid=probe]").inner_text().lower()
            if not any(k in reads for k in LAND_READS):
                fail(f"{ev['id']}: area {r['n']} probe reads '{reads[-60:]}'")
            pg.screenshot(path=f"{OUT}/areas-{ev['id']}-{r['n']}.png")
        print(f"   {len(regs)} areas clicked: zoomed clear of panels, probes read land change")
    print("\npage errors:", errs or "none")
    b.close()
print("RESULT:", "PASS" if not failures and not errs else f"FAIL ({len(failures)})")
sys.exit(1 if failures or errs else 0)
