#!/bin/sh
# Virtual screen -> VNC server -> noVNC web page -> playwright-mcp, headed.
# Every argument is passed straight through to playwright-mcp (the service's
# `command` in deploy/docker-compose.yml).
set -e

export DISPLAY=":${DISPLAY_NUM:-99}"
SCREEN_SIZE=${SCREEN_SIZE:-1440x900x24}

# `docker compose restart` reuses the container filesystem, so the previous
# run's lock files are still there and Xvfb refuses to start ("Server is
# already active for display 99"). Nothing else owns this display, and both
# files belong to this user, so clearing them is safe — hit for real: after a
# restart the whole service crash-looped and every Gmail tool answered "the
# browser service is unreachable".
rm -f "/tmp/.X${DISPLAY_NUM:-99}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM:-99}"

Xvfb "$DISPLAY" -screen 0 "$SCREEN_SIZE" -nolisten tcp &
# x11vnc exits immediately against a display that is not up yet, which would
# leave the viewer dead while everything else looks healthy.
for _ in $(seq 1 50); do
  xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
  sleep 0.2
done

# -nopw is only safe because 6080 is published on loopback and reached over an
# SSH tunnel (docker-compose.yml). Anyone who opens that page can read and
# send mail as the signed-in account.
x11vnc -display "$DISPLAY" -forever -shared -nopw -rfbport 5900 -quiet -bg >/dev/null
# The viewer is served at the extensionless URL http://127.0.0.1:6080/vnc:
# novnc-clean-url.py wraps stock websockify and rewrites /vnc to the real
# vnc.html (a plain copy or subdirectory would break MIME types / relative
# asset paths — see that file).
python3 /usr/local/bin/novnc-clean-url.py &

exec node /app/cli.js "$@"
