"""Browser smoke test for the dashboard, run against the dev servers:

    cd sars-frontend && uv run --with playwright python -I e2e/smoke.py [http://localhost:5173]

Drives every map action a judge will try (wheel zoom, fit, pan, swipe, dated HLS basemap, colour
composite, area fly-to + probe, sidebar open/close, phone layout) and prints what it saw; any
page error or console error fails the run.
"""

import sys

from playwright.sync_api import sync_playwright


def pick(pg, event_id):
    """Open the event dropdown and choose an event by id."""
    pg.get_by_role("combobox", name="Choose an event").or_(
        pg.locator("[aria-label='Choose an event']")
    ).first.click()
    pg.wait_for_timeout(400)
    pg.locator(f"[data-event='{event_id}']").click()


URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
MEGHNA = "meghna-monsoon"

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    errs: list[str] = []
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on(
        "console",
        lambda m: (
            m.type in ("error", "warning")
            and "ERR_ABORTED" not in m.text
            and "404" not in m.text
            and errs.append(m.text[:160])
        ),
    )
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)[:160]))
    pg.goto(URL)
    pg.wait_for_timeout(2000)
    pg.wait_for_timeout(5000)
    pg.locator("[aria-label='Choose an event']").click()
    pg.wait_for_timeout(400)
    events = pg.locator("[data-event]").evaluate_all("els => els.map(e => e.dataset.event)")
    pg.keyboard.type("flood")
    pg.wait_for_timeout(300)
    print(
        "events:",
        events,
        "| search 'flood' ->",
        pg.locator("[data-event]").evaluate_all("els => els.map(e => e.dataset.event)"),
    )
    pg.keyboard.press("Escape")
    print("default:", pg.locator("aside h1").first.inner_text())

    def scale():
        return pg.locator(".leaflet-control-scale-line").first.inner_text()

    pg.mouse.move(600, 300)
    pg.mouse.wheel(0, -300)
    pg.wait_for_timeout(1000)
    print("wheel zoom:", scale())
    pg.get_by_role("button", name="Fit the event in view").click()
    pg.wait_for_timeout(900)
    print("fit:", scale())

    def transform():
        return pg.evaluate("document.querySelector('.leaflet-map-pane').style.transform")

    t0 = transform()
    pg.mouse.move(600, 300)
    pg.mouse.down()
    pg.mouse.move(750, 400, steps=8)
    pg.mouse.up()
    pg.wait_for_timeout(400)
    print("pan:", t0 != transform())

    sw = pg.get_by_role("slider", name="Swipe between before and after")
    hb = sw.bounding_box()
    pg.mouse.move(hb["x"] + 20, hb["y"] + 20)
    pg.mouse.down()
    pg.mouse.move(hb["x"] + 320, hb["y"] + 20, steps=10)
    pg.mouse.up()
    pg.wait_for_timeout(300)
    print("swipe:", sw.get_attribute("aria-valuenow"))

    if MEGHNA in events:
        pick(pg, MEGHNA)
        pg.wait_for_timeout(6000)
    print(
        "regions:",
        [" | ".join(t.split("\n")) for t in pg.locator("aside ol li").all_inner_texts()[:2]],
    )
    pg.get_by_label("Basemap").select_option("hls")
    pg.wait_for_timeout(8000)
    print(
        "hls panes:",
        pg.evaluate(
            "['tilesBefore','tilesAfter'].map(n => { const p = document.querySelector('.leaflet-' + n + '-pane');"
            " const t = p ? [...p.querySelectorAll('img')] : []; return [n, t.filter(i => i.naturalWidth > 0).length,"
            " t[0] && (t[0].src.match(/\\d{4}-\\d{2}-\\d{2}/) || [''])[0]] })"
        ),
    )
    print("chips:", pg.locator("[data-testid^=chip] span span:last-child").all_inner_texts())
    # The change layers and their switches live in the "Only changes" view.
    only_changes = pg.get_by_role("radio", name="Only changes")
    if only_changes.count():
        only_changes.click()
        pg.wait_for_timeout(1000)
    colour = pg.get_by_role("switch", name="Colour (HH/HV)")
    if colour.count():
        colour.click()
        pg.wait_for_timeout(2000)
        print(
            "colour layers:",
            sorted(
                {
                    i.get_attribute("src").split("/")[-1]
                    for i in pg.locator(".leaflet-image-layer").all()
                }
            ),
        )
    search = pg.get_by_placeholder("Search by number, or darker, brighter, rougher")
    search.fill("darker")
    pg.wait_for_timeout(300)
    print(
        "area search 'darker':",
        pg.locator("aside ol li").count(),
        "of",
        pg.locator("[data-testid=area-list]").locator("xpath=..").locator("p").last.inner_text(),
    )
    search.fill("")
    areas = pg.get_by_role("switch", name="Areas")
    areas.click()
    pg.wait_for_timeout(400)
    hidden = (pg.locator(".region-badge").count(), pg.locator(".leaflet-areas-pane path").count())
    areas.click()
    pg.wait_for_timeout(400)
    print(
        "Areas switch hides markers and outlines:",
        hidden == (0, 0),
        "and brings them back:",
        pg.locator(".region-badge").count() > 0,
    )
    if pg.locator("aside ol li button").count():
        pg.locator("aside ol li button").first.click()
        pg.wait_for_timeout(2500)
        print(
            "region fly-to:",
            scale(),
            "| probe:",
            " | ".join(pg.locator("[data-testid=probe]").inner_text().split("\n"))[:90],
        )
    panel = pg.get_by_role("complementary", name="Events and details")
    print("sidebar open by default:", panel.count())
    view = "() => { const m = window.__map, c = m.getCenter(); const k = document.querySelector('[aria-label=\"Swipe between before and after\"]').getBoundingClientRect(); return [c.lat.toFixed(6), c.lng.toFixed(6), m.getZoom(), Math.round(k.left)] }"
    before = pg.evaluate(view)
    pg.get_by_role("button", name="Close sidebar").click()
    pg.wait_for_timeout(600)
    closed = panel.count()
    after_close = pg.evaluate(view)
    pg.get_by_role("button", name="Open sidebar").click()
    pg.wait_for_timeout(600)
    print("sidebar closes and reopens:", closed == 0 and panel.count() == 1)
    print(
        "map unchanged by close/open (centre, zoom, divider):",
        before == after_close == pg.evaluate(view),
        before,
    )

    mob = b.new_page(viewport={"width": 360, "height": 800}, has_touch=True, is_mobile=True)
    mob.goto(URL)
    mob.wait_for_timeout(7000)
    print(
        "phone: sidebar closed by default:",
        mob.get_by_role("complementary", name="Events and details").count() == 0,
    )
    tb = mob.get_by_test_id("toolbar").bounding_box()
    print(
        f"360px toolbar x={tb['x']:.0f} right={tb['x'] + tb['width']:.0f} | overflow:",
        mob.evaluate("document.documentElement.scrollWidth > innerWidth"),
    )
    print("errors:", errs or "none")
    b.close()
    sys.exit(1 if errs else 0)
