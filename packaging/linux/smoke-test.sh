#!/usr/bin/env bash
# Start a packaged WH3 Mod Manager binary under Xvfb and wait for its window.
#
# Usage: smoke-test.sh /path/to/wh3mm
#
# The packaged AppImage contains a desktop bootstrapper, so pass the AppImage
# itself as the argument. Runtime libraries (WebKitGTK 4.1, GTK3) are supplied
# by the host or by the .deb package; this script only provisions the headless
# display, a session bus, and the window query.
set -euo pipefail

binary=${1:-/usr/bin/wh3mm}
if [ ! -x "$binary" ]; then
  echo "smoke-test: $binary is missing or not executable" >&2
  exit 1
fi

log=$(mktemp)
trap 'rm -f "$log"' EXIT

export SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-45}"
export BINARY="$binary"
export LOG="$log"

# The CI containers run as root. WebKit's bubblewrap sandbox cannot start as
# root in that environment, and Xvfb has no GPU. Both settings only affect the
# test process.
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export GDK_BACKEND=x11

# AppImages mount through FUSE 2. CI runs inside containers without /dev/fuse,
# so fall back to the runtime's extract-and-run mode, which launches the same
# embedded payload without mounting. On a host with FUSE, the mount path runs.
if [[ "$binary" == *.AppImage && ! -e /dev/fuse ]]; then
  export APPIMAGE_EXTRACT_AND_RUN="${APPIMAGE_EXTRACT_AND_RUN:-1}"
fi

xvfb-run -a --server-args="-screen 0 1280x900x24" dbus-run-session -- bash -c '
  set -euo pipefail
  "$BINARY" >"$LOG" 2>&1 &
  pid=$!
  for _ in $(seq 1 "$SMOKE_TIMEOUT"); do
    if xdotool search --name "WH3 Mod Manager" >/dev/null 2>&1; then
      echo "smoke-test: window found ($BINARY)"
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      exit 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "smoke-test: process exited before opening a window" >&2
      cat "$LOG" >&2
      exit 1
    fi
    sleep 1
  done
  echo "smoke-test: no window after ${SMOKE_TIMEOUT}s" >&2
  cat "$LOG" >&2
  kill "$pid" 2>/dev/null || true
  exit 1
'
