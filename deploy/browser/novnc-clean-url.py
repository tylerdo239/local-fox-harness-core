#!/usr/bin/env python3
"""Serve the noVNC viewer at the extensionless URL /vnc.

Stock `websockify --web=/usr/share/novnc` only serves the exact file
vnc.html, so http://127.0.0.1:6080/vnc is a 404 out of the box. Two
obvious tricks do NOT work, which is why this wrapper exists:

* A plain copy/symlink named `vnc` (no extension): Python's mimetypes
  guesses application/octet-stream for extensionless files, so browsers
  download the page instead of rendering it.
* A `vnc/` subdirectory with index.html: vnc.html references assets
  relatively (app/..., ./defaults.json), so they would resolve to
  /vnc/app/... and 404.

Instead this subclasses websockify's own request handler and rewrites
/vnc and /vnc/ to /vnc.html *before* the static handler runs. The page
keeps its root-level URL base, so relative assets and the relative
websocket path (websockify) keep working unchanged. One process, same
port, correct text/html MIME.

URL policy:
  /vnc, /vnc/   -> served as vnc.html (200, text/html), query preserved
  /vnc.html...  -> 301 redirect to /vnc (canonical URL, query preserved)
  else          -> untouched websockify behaviour (static files +
                   websocket proxy to the VNC server)
"""

import os
import sys
from urllib.parse import urlsplit, urlunsplit

from websockify.websocketproxy import ProxyRequestHandler, WebSocketProxy

CANONICAL_PATH = "/vnc"
LEGACY_PATH = "/vnc.html"


class CleanUrlHandler(ProxyRequestHandler):
    """Rewrite the clean viewer URL to the real noVNC file."""

    def _rewrite_vnc_url(self):
        """Return 'redirect' if a redirect was sent, else rewrite in place."""
        parts = urlsplit(self.path)
        if parts.path == LEGACY_PATH:
            target = urlunsplit(("", "", CANONICAL_PATH, parts.query, ""))
            self.send_response(301)
            self.send_header("Location", target)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return "redirect"
        if parts.path in (CANONICAL_PATH, CANONICAL_PATH + "/"):
            self.path = urlunsplit(("", "", LEGACY_PATH, parts.query, ""))
        return None

    def do_GET(self):
        if self._rewrite_vnc_url() == "redirect":
            return
        super().do_GET()

    def do_HEAD(self):
        if self._rewrite_vnc_url() == "redirect":
            return
        super().do_HEAD()


def main():
    web_root = os.environ.get("NOVNC_WEB_ROOT", "/usr/share/novnc")
    if not os.path.isfile(os.path.join(web_root, "vnc.html")):
        print("novnc-clean-url: %s/vnc.html not found" % web_root,
              file=sys.stderr)
        sys.exit(1)
    server = WebSocketProxy(
        CleanUrlHandler,
        listen_host=os.environ.get("NOVNC_LISTEN_HOST", ""),
        listen_port=int(os.environ.get("NOVNC_LISTEN_PORT", "6080")),
        target_host=os.environ.get("VNC_TARGET_HOST", "localhost"),
        target_port=int(os.environ.get("VNC_TARGET_PORT", "5900")),
        web=web_root,
        verbose=False,
        daemon=False,
        record="",
        run_once=False,
        traffic=False,
    )
    server.start_server()


if __name__ == "__main__":
    main()
