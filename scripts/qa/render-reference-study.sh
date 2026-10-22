#!/usr/bin/env bash
# Render the WAR-147 reference study plate from our own HTML at both required
# viewports. Requires Chromium (CHROME_PATH overrides the binary).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out="$root/docs/screenshots/WAR-147"
chrome="${CHROME_PATH:-}"
if [[ -z "$chrome" ]]; then
  for candidate in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome; do
    if [[ -x "$candidate" ]]; then chrome="$candidate"; break; fi
  done
fi
if [[ -z "$chrome" ]]; then
  echo "No Chromium binary found; set CHROME_PATH" >&2
  exit 1
fi

mkdir -p "$out"
for viewport in 1920,1080 1366,768; do
  width="${viewport%,*}"
  height="${viewport#*,}"
  "$chrome" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --window-size="$width,$height" \
    --screenshot="$out/reference-study__${width}x${height}.png" \
    "file://$root/scripts/qa/reference-study.html" >/dev/null 2>&1
  echo "wrote $out/reference-study__${width}x${height}.png"
done
