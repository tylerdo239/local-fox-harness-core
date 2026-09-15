#!/bin/sh
# Materializes $DSH_HOME/profiles/cordis-app (a real dsh profile directory —
# see docs/cordis-agent-implementation-plan.md §2.1/§3 in the parent
# local-agent-core checkout for why this can't just be a committed package)
# and boots it. Idempotent: safe to run on every container start.
set -eu

: "${DSH_HOME:?DSH_HOME must be set}"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
BUNDLE_DIR="$REPO_ROOT/packages/bundle-core"
PROFILE_DIR="$DSH_HOME/profiles/cordis-app"
DSH_BIN="$REPO_ROOT/node_modules/.bin/dsh"

mkdir -p "$PROFILE_DIR"

# package.json is regenerated every start: the bundle list is composition
# (rebuild-tier), and BUNDLE_DIR's absolute path can change across images.
cat > "$PROFILE_DIR/package.json" <<EOF
{
  "name": "dsh-profile-cordis-app",
  "private": true,
  "dependencies": {
    "@cordis-app/bundle-core": "link:$BUNDLE_DIR"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@cordis-app/bundle-core"],
      "patchReload": "startup"
    }
  }
}
EOF

# cordis.yml and cordis.patch.yml are the user/data layer: created once,
# never overwritten again (cordis.patch.yml is where a human edits behavior
# from outside the container, per plan §7 — clobbering it on restart would
# silently discard that).
[ -f "$PROFILE_DIR/cordis.yml" ] || printf '[]\n' > "$PROFILE_DIR/cordis.yml"
[ -f "$PROFILE_DIR/cordis.patch.yml" ] || cp "$REPO_ROOT/deploy/profile-template/cordis-app/cordis.patch.yml" "$PROFILE_DIR/cordis.patch.yml"

cd "$REPO_ROOT"
"$DSH_BIN" plugin --profile cordis-app install >&2

# dsh's own --host flag hard-rejects 0.0.0.0 ("intentionally not supported
# yet for safety", packages/bundle/web-app/src/startup.ts:75 in the upstream
# source) — correct for a bare host process, but it means dsh can only bind
# loopback INSIDE the container. Confirmed for real against the git-fork
# build of this image on Docker Desktop (macOS): `docker compose up` +
# `curl 127.0.0.1:$CORDIS_PORT` from the host got "Empty reply from server"
# even though the same request succeeded from inside the container — Docker's
# published-port path does not reach a service bound only to the container's
# loopback there. socat bridges the gap: it binds 0.0.0.0 (which the
# published port can reach) and forwards to dsh's own loopback-only
# listener, so dsh's safety check and the container's outside reachability
# both hold.
CORDIS_PORT="${CORDIS_PORT:-3080}"
CORDIS_INTERNAL_PORT="${CORDIS_INTERNAL_PORT:-3081}"
if command -v socat >/dev/null 2>&1; then
  socat "TCP-LISTEN:${CORDIS_PORT},bind=0.0.0.0,fork,reuseaddr" "TCP:127.0.0.1:${CORDIS_INTERNAL_PORT}" &
fi

exec "$DSH_BIN" --profile cordis-app --no-open --host 127.0.0.1 --port "$CORDIS_INTERNAL_PORT" "$@"
