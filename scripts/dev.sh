#!/bin/sh
# Local (non-Docker) dev runner. Thin wrapper around deploy/entrypoint.sh —
# same boot script Docker uses, parameterized for a bare host process
# instead of a container, so there is exactly one place that knows how to
# materialize and boot the cordis-app profile, not two copies to keep in
# sync. See ../README.md "Run it" for the full explanation.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

# Node 22.19+/24 required (dsh's own engines field) — the default `node` on
# a dev machine may be older; nvm/homebrew installs of 22 are common
# alternatives. Fail loud with a clear message instead of a cryptic
# ERR_UNSUPPORTED_ESM_URL_SCHEME or similar deep in dsh's own boot.
NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 22 ] 2>/dev/null; then
  echo "error: Node 22.19+ or 24+ required, found $(node -v 2>/dev/null || echo 'no node on PATH')." >&2
  echo "       If you use nvm: nvm install 22 && nvm use 22" >&2
  exit 1
fi

# Separate from Docker's data/harness (gitignored, repo-root sibling of
# deploy/ per docker-compose.yml) so running both at once never shares or
# corrupts state.
export DSH_HOME="${DSH_HOME:-$REPO_ROOT/.dev-state/harness}"
export CORDIS_WORKSPACE_ROOT="${CORDIS_WORKSPACE_ROOT:-$REPO_ROOT/.dev-state/workspace}"
export CORDIS_BUNDLED_SKILL_DIR="${CORDIS_BUNDLED_SKILL_DIR:-$REPO_ROOT/packages/skills}"
mkdir -p "$DSH_HOME" "$CORDIS_WORKSPACE_ROOT"

# Unconditional, not "only if missing": a no-op pnpm install is ~200ms and a
# full rebuild is a few seconds (measured), cheap enough to run on every
# start so restarting after a `git pull` or editing any package's src/
# apps/web always boots the code actually on disk — no stale-build
# footgun from a conditional check that only rebuilds when output is absent.
echo "==> pnpm install..." >&2
(cd "$REPO_ROOT" && pnpm install)
echo "==> pnpm run build..." >&2
(cd "$REPO_ROOT" && pnpm run build)

# No Docker here, so no published-port gap to bridge with socat — dsh binds
# the same port the browser opens, directly.
export CORDIS_PORT="${CORDIS_PORT:-3080}"
export CORDIS_INTERNAL_PORT="$CORDIS_PORT"
export SKIP_SOCAT=1

exec "$SCRIPT_DIR/../deploy/entrypoint.sh" "$@"
