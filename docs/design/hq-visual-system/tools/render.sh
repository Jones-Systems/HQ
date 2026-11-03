#!/usr/bin/env bash
# Render HQ visual-system artwork and evidence screenshots with headless Chromium.
#
#   tools/render.sh artwork    # (re)create mockups/assets/*.png from mockups/assets/src (only when artwork changes)
#   tools/render.sh evidence   # capture evidence/*.png and evidence/layout/*.json from the mockup pages
#
# Run from docs/design/hq-visual-system. Needs `chromium` (or CHROMIUM=/path) and network access for the
# IBM Plex web fonts the mockups link; without them the pages fall back to system fonts and the layout
# JSON records fonts:false. No --user-data-dir is passed: headless Chromium creates and removes its own
# temporary profile, so this script owns no scratch directory. Outputs go only to the paths named below.
set -euo pipefail

cd "$(dirname "$0")/.."
CHROMIUM="${CHROMIUM:-chromium}"

# $1 url  $2 out.png  $3 WxH  $4 os-scheme(light|dark)  [$5 extra flag]
shot() {
  local pref=1; [[ "$4" == dark ]] && pref=0
  "$CHROMIUM" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --blink-settings=preferredColorScheme=$pref \
    --window-size="$3" --virtual-time-budget=6000 ${5:-} --screenshot="$2" "$1" >/dev/null 2>&1
  [[ -s "$2" ]] || { echo "render failed: $1" >&2; return 1; }
}
# Same page, same flags, but dump the DOM and keep only the evidence JSON the page writes to <title>.
layout() {
  local pref=1; [[ "$4" == dark ]] && pref=0
  "$CHROMIUM" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --blink-settings=preferredColorScheme=$pref \
    --window-size="$3" --virtual-time-budget=6000 --dump-dom "$1" 2>/dev/null \
    | python3 -I -c 'import sys,re,html; m=re.search(r"<title>(.*?)</title>", sys.stdin.read(), re.S); print(html.unescape(m.group(1)) if m else "{}")' > "$2"
}

page() { echo "file://$PWD/mockups/$1"; }

case "${1:-}" in
  artwork)
    src="file://$PWD/mockups/assets/src"
    shot "$src/larkspur-landing.html?variant=light" mockups/assets/larkspur-landing-light.png 1440,900 light
    shot "$src/larkspur-landing.html?variant=dark" mockups/assets/larkspur-landing-dark.png 1440,900 light
    shot "$src/larkspur-mark.html" mockups/assets/larkspur-mark.png 512,512 light --default-background-color=00000000
    ;;
  evidence)
    mkdir -p evidence/layout
    # name | page+query | window | OS scheme
    while IFS='|' read -r name query size os; do
      [[ -z "$name" || "$name" == \#* ]] && continue
      shot "$(page "$query")" "evidence/$name.png" "$size" "$os"
      layout "$(page "$query")" "evidence/layout/$name.json" "$size" "$os"
      echo "captured $name"
    done <<'EOF'
design-dark-1280|design.html?theme=dark|1280,820|light
design-light-1280|design.html?theme=light|1280,820|dark
design-system-os-dark-1280|design.html?theme=system|1280,820|dark
design-system-os-light-1280|design.html?theme=system|1280,820|light
design-dark-760|design.html?theme=dark|760,560|light
design-light-760-drawer|design.html?theme=light&drawer=open|760,560|light
design-dark-t0-slots-1280|design.html?theme=dark&slots=design|1280,820|light
work-dark-1440|work.html?theme=dark|1440,900|light
work-light-1440|work.html?theme=light|1440,900|light
work-dark-760|work.html?theme=dark|760,560|light
social-dark-1280|social.html?theme=dark|1280,820|light
social-light-1280|social.html?theme=light|1280,820|light
states-1440|states.html|1440,2664|light
artwork-invariance-1440|artwork.html|1440,900|light
EOF
    ;;
  *) sed -n '2,10p' "$0" >&2; exit 2 ;;
esac
