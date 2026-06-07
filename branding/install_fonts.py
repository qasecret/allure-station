#!/usr/bin/env python3
import os, shutil
from fontTools.ttLib import TTFont

dests = [os.path.expanduser("~/.fonts")]
mac = os.path.expanduser("~/Library/Fonts")
if os.path.isdir(os.path.dirname(mac)):
    dests.append(mac)
for d in dests:
    os.makedirs(d, exist_ok=True)

for w in (400, 500, 600, 700):
    f = TTFont(f"node_modules/@fontsource/sora/files/sora-latin-{w}-normal.woff2")
    f.flavor = None                       # woff2 -> plain TTF
    tmp = f"Sora-{w}.ttf"
    f.save(tmp)
    for d in dests:
        shutil.copy(tmp, os.path.join(d, tmp))
    os.remove(tmp)
print("Sora installed to:", dests)
