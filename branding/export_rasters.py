#!/usr/bin/env python3
import cairosvg
jobs = [
    # GitHub social preview (recommended 1280x640, min 640x320) — exact 2:1 sizes:
    ("allure-station-github-banner.svg", "allure-station-github-1280x640.png", 1280, 640),
    ("allure-station-github-banner.svg", "allure-station-github-2560x1280.png", 2560, 1280),
    ("allure-station-github-banner.svg", "allure-station-github-640x320.png",   640,  320),
    # icons (transparent), favicon, and lockups (proportional):
    ("allure-station-icon.svg",        "allure-station-icon-1024.png",     1024, 1024),
    ("allure-station-icon.svg",        "allure-station-icon-512.png",       512,  512),
    ("allure-station-icon.svg",        "allure-station-favicon-64.png",      64,   64),
    ("allure-station-icon-hub.svg",    "allure-station-icon-hub-512.png",   512,  512),
    ("allure-station-mark-mono.svg",   "allure-station-mark-mono-512.png",  512,  512),
    ("allure-station-lockup.svg",      "allure-station-lockup.png",        1800, None),
    ("allure-station-lockup-dark.svg", "allure-station-lockup-dark.png",   1800, None),
]
for src, out, w, h in jobs:
    if h is None:
        cairosvg.svg2png(url=src, write_to=out, output_width=w)
    else:
        cairosvg.svg2png(url=src, write_to=out, output_width=w, output_height=h)
    print("wrote", out)
