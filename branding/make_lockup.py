#!/usr/bin/env python3
import re
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

FONTS = {
    700: "node_modules/@fontsource/sora/files/sora-latin-700-normal.woff2",
    500: "node_modules/@fontsource/sora/files/sora-latin-500-normal.woff2",
}
_fcache = {}
def get_font(w):
    if w not in _fcache:
        f = TTFont(FONTS[w])
        _fcache[w] = {"font": f, "glyphs": f.getGlyphSet(), "cmap": f.getBestCmap(),
                      "upm": f["head"].unitsPerEm, "hmtx": f["hmtx"]}
    return _fcache[w]

def render_word(text, weight, size, x0, baseline, tracking=0.0):
    F = get_font(weight); s = size / F["upm"]; x = x0; parts = []
    for ch in text:
        g = F["cmap"].get(ord(ch)); adv = F["hmtx"][g][0] if g else int(0.33 * F["upm"])
        if g and ch != " ":
            pen = SVGPathPen(F["glyphs"]); F["glyphs"][g].draw(pen); d = pen.getCommands()
            if d:
                parts.append(f'<g transform="translate({x:.2f} {baseline:.2f}) scale({s:.5f} {-s:.5f})"><path d="{d}"/></g>')
        x += adv * s + tracking
    return "".join(parts), x - x0

def icon_inner():
    raw = open("allure-station-icon.svg").read()
    return re.search(r"<svg[^>]*>(.*)</svg>", raw, re.S).group(1)

def build_lockup(path, ink, accent, bg=None):
    SIZE, ICON, GAP, PADX = 64, 96, 30, 26
    H = 132
    icon_x, icon_y = 26, (H - ICON) / 2
    text_x = icon_x + ICON + GAP
    baseline = 86.0
    w1, adv1 = render_word("Allure", 700, SIZE, text_x, baseline, tracking=-0.4)
    space = SIZE * 0.30
    w2, adv2 = render_word("Station", 500, SIZE, text_x + adv1 + space, baseline, tracking=-0.4)
    W = round(text_x + adv1 + space + adv2 + PADX)
    bg_rect = f'<rect width="{W}" height="{H}" rx="26" fill="{bg}"/>' if bg else ""
    icon = (f'<svg x="{icon_x}" y="{icon_y:.1f}" width="{ICON}" height="{ICON}" viewBox="0 0 256 256">{icon_inner()}</svg>')
    svg = (f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Allure Station">'
           f'{bg_rect}{icon}<g fill="{ink}">{w1}</g><g fill="{accent}">{w2}</g></svg>')
    open(path, "w").write(svg)
    print(f"{path}  ->  {W}x{H}")

build_lockup("allure-station-lockup.svg",      "#0F1B2D", "#0F9E78")
build_lockup("allure-station-lockup-dark.svg", "#FFFFFF", "#2FD9B2", bg="#0B1220")
