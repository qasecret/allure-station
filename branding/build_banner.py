#!/usr/bin/env python3
import re
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

FONTS = {w: f"node_modules/@fontsource/sora/files/sora-latin-{w}-normal.woff2" for w in (400,500,600,700)}
_c = {}
def F(w):
    if w not in _c:
        f = TTFont(FONTS[w]); _c[w] = (f, f.getGlyphSet(), f.getBestCmap(), f["head"].unitsPerEm, f["hmtx"])
    return _c[w]

def measure(text, w, size, tracking=0.0):
    f, gs, cmap, upm, hmtx = F(w); s = size/upm; x = 0.0
    for ch in text:
        g = cmap.get(ord(ch)); x += (hmtx[g][0] if g else int(.33*upm))*s + tracking
    return x

def word_paths(text, w, size, x0, baseline, tracking=0.0):
    f, gs, cmap, upm, hmtx = F(w); s = size/upm; x = x0; out = []
    for ch in text:
        g = cmap.get(ord(ch)); adv = (hmtx[g][0] if g else int(.33*upm))
        if g and ch != " ":
            pen = SVGPathPen(gs); gs[g].draw(pen); d = pen.getCommands()
            if d: out.append(f'<g transform="translate({x:.2f} {baseline:.2f}) scale({s:.5f} {-s:.5f})"><path d="{d}"/></g>')
        x += adv*s + tracking
    return "".join(out), x - x0

icon_inner = re.search(r"<svg[^>]*>(.*)</svg>", open("allure-station-icon.svg").read(), re.S).group(1)

W, H = 1280, 640
INK, DIM, TEAL = "#FFFFFF", "#9DB2C4", "#2FD9B2"
LX = 80

hero1, a1 = word_paths("Allure", 700, 84, LX, 250, tracking=-0.5)
space = 84*0.30
hero2, a2 = word_paths("Station", 500, 84, LX + a1 + space, 250, tracking=-0.5)

chips = ["Multi-project", "Live updates", "Quality gates", "OIDC / SSO", "Single container"]
chip_svg = []
cx, cy, gap, maxx = LX, 420, 12, LX + 715
ch_h, padX, fs = 40, 16, 16
for c in chips:
    tw = measure(c, 500, fs)
    w = tw + 30 + padX
    if cx + w > maxx: cx, cy = LX, cy + ch_h + 12
    chip_svg.append(
        f'<g><rect x="{cx:.1f}" y="{cy}" width="{w:.1f}" height="{ch_h}" rx="{ch_h/2}" '
        f'fill="rgba(255,255,255,0.04)" stroke="rgba(47,217,178,0.38)"/>'
        f'<circle cx="{cx+padX:.1f}" cy="{cy+ch_h/2}" r="3" fill="{TEAL}"/>'
        f'<text x="{cx+padX+12:.1f}" y="{cy+ch_h/2+5.5:.1f}" font-family="Sora" font-weight="500" '
        f'font-size="{fs}" fill="#CFE8E0">{c}</text></g>')
    cx += w + gap

ICX, ICY, IS = 890, 170, 300
cen_x, cen_y = ICX + IS/2, ICY + IS/2

svg = f'''<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Allure Station — self-hosted Allure 3 report hub">
<defs>
  <linearGradient id="bnbg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0C1626"/><stop offset="0.55" stop-color="#0A1220"/><stop offset="1" stop-color="#070D18"/>
  </linearGradient>
  <radialGradient id="gA" cx="0.12" cy="0.0" r="0.7">
    <stop offset="0" stop-color="#1ED6B2" stop-opacity="0.20"/><stop offset="0.7" stop-color="#1ED6B2" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="gB" cx="0.82" cy="0.5" r="0.55">
    <stop offset="0" stop-color="#12B58F" stop-opacity="0.40"/><stop offset="0.75" stop-color="#12B58F" stop-opacity="0"/>
  </radialGradient>
  <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
    <circle cx="1.4" cy="1.4" r="1.4" fill="#9FE9D6" fill-opacity="0.05"/>
  </pattern>
  <filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="26"/></filter>
</defs>
<rect width="{W}" height="{H}" fill="url(#bnbg)"/>
<rect width="{W}" height="{H}" fill="url(#dots)"/>
<rect width="{W}" height="{H}" fill="url(#gA)"/>
<rect width="{W}" height="{H}" fill="url(#gB)"/>
<g fill="none" stroke="#46E3C4">
  <circle cx="{cen_x}" cy="{cen_y}" r="208" stroke-opacity="0.14"/>
  <circle cx="{cen_x}" cy="{cen_y}" r="284" stroke-opacity="0.09"/>
</g>
<g fill="#8FF0DB">
  <circle cx="{cen_x-284}" cy="{cen_y-16}" r="6" fill-opacity="0.85"/>
  <circle cx="{cen_x+201}" cy="{cen_y-200}" r="5" fill-opacity="0.7"/>
  <circle cx="{cen_x+250}" cy="{cen_y+138}" r="5" fill-opacity="0.7"/>
</g>
<ellipse cx="{cen_x}" cy="{cen_y+34}" rx="150" ry="120" fill="#03110D" fill-opacity="0.55" filter="url(#soft)"/>
<g filter="url(#soft)"><circle cx="{cen_x}" cy="{cen_y}" r="150" fill="#1ED6B2" fill-opacity="0.22"/></g>
<svg x="{ICX}" y="{ICY}" width="{IS}" height="{IS}" viewBox="0 0 256 256">{icon_inner}</svg>
<text x="{LX}" y="148" font-family="Sora" font-weight="600" font-size="15" letter-spacing="4" fill="{TEAL}">SELF-HOSTED HUB FOR ALLURE 3 REPORTS</text>
<g fill="{INK}">{hero1}</g><g fill="{TEAL}">{hero2}</g>
<text x="{LX}" y="322" font-family="Sora" font-weight="400" font-size="22" fill="{DIM}">Self-hosted, multi-project Allure 3 report hosting.</text>
<text x="{LX}" y="354" font-family="Sora" font-weight="400" font-size="22" fill="{DIM}">Push from any CI — serve live reports to your whole team.</text>
{''.join(chip_svg)}
</svg>'''

open("allure-station-github-banner.svg", "w").write(svg)
print("banner written")
