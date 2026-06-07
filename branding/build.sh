#!/usr/bin/env bash
# Regenerate all Allure Station brand assets from the source SVGs + Sora.
# Prereqs (one-time):
#   cd branding && npm install
#   python3 -m pip install --upgrade cairosvg fonttools brotli pillow
#   (cairosvg needs native Cairo — macOS: brew install cairo pango gdk-pixbuf libffi)
set -euo pipefail
cd "$(dirname "$0")"

python3 install_fonts.py
fc-cache -f 2>/dev/null || true   # safe to ignore on macOS
python3 make_lockup.py
python3 build_banner.py
python3 export_rasters.py

# favicon.ico (multi-resolution) from the primary icon
python3 -c "import cairosvg; cairosvg.svg2png(url='allure-station-icon.svg', write_to='_fav256.png', output_width=256, output_height=256)"
python3 -c "from PIL import Image; Image.open('_fav256.png').save('favicon.ico', sizes=[(16,16),(32,32),(48,48)])"
rm -f _fav256.png

# Sync the assets the app + docs consume out of branding/ into their homes.
echo "→ syncing consumed assets"
cp allure-station-lockup.svg allure-station-lockup-dark.svg \
   allure-station-icon.svg allure-station-icon-hub.svg allure-station-mark-mono.svg \
   ../docs/brand/
cp favicon.ico ../packages/web/public/favicon.ico
cp allure-station-icon.svg ../packages/web/public/favicon.svg
cp allure-station-icon-512.png ../packages/web/public/apple-touch-icon.png

echo "✓ brand assets regenerated."
echo "  Reminder: set the GitHub social preview manually —"
echo "  upload branding/allure-station-github-1280x640.png at Settings → General → Social preview."
