# Microsoft's Playwright MCP image plus a virtual screen and a browser-based
# VNC viewer: the browser the agent drives becomes something a human can WATCH
# live — and drive by hand, which is also how the Gmail sign-in is renewed
# once the saved session expires.
#
# Nothing about MCP changes here; this is packaging. The upstream image ships
# Xvfb but no VNC, and runs the browser headless.
FROM mcr.microsoft.com/playwright/mcp:v0.0.82
USER root
RUN apt-get update && apt-get install --no-install-recommends -y \
      xvfb x11vnc novnc websockify x11-utils \
 && rm -rf /var/lib/apt/lists/*
# X's socket directory must exist, owned by root, mode 1777 — Xvfb refuses a
# directory it does not trust ("Owner of /tmp/.X11-unix should be set to
# root", hit for real when the entrypoint created it as the service user).
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix
# The downloads volume takes its ownership from this directory the first time
# it is created, and the service runs as the host user, not as root.
RUN mkdir -p /downloads /profile && chmod 1777 /downloads /profile
COPY deploy/browser/entrypoint.sh /usr/local/bin/entrypoint.sh
# The compose service overrides this with the host user that owns
# secrets/gmail — see docker-compose.yml.
USER node
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
