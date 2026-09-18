#!/bin/sh
# Local (non-Docker) dev runner. Thin wrapper around deploy/entrypoint.sh —
# same boot script Docker uses, parameterized for a bare host process
# instead of a container, so there is exactly one place that knows how to
# materialize and boot the cordis-app profile, not two copies to keep in
# sync. See ../README.md "Run it" for the full explanation.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$REPO_ROOT/.env"

# First-run setup wizard — user request: a non-Docker user should be able to
# go from a fresh checkout to a running app with ONE command, not
# `cp .env.example .env` + manually editing it + THEN running this script.
# Only asks for OPENAI_API_KEY/OPENAI_MODEL_ID (the 2 values with no safe
# default — everything else in .env.example has one); BASE_URL/EXTRA_BODY/
# CONTEXT_WINDOW stay editable by hand afterward (advanced, rarely needed
# for a first try). `[ -t 0 ]` skips this silently in a non-interactive
# shell (CI, piped stdin) instead of hanging on `read` — falls through to
# .env.example's own placeholders/defaults there. `|| true` on each `read`:
# POSIX still assigns the variable (empty) on EOF, so treat an unexpected
# Ctrl-D as "left blank" rather than aborting the whole script via `set -e`.
if [ ! -f "$ENV_FILE" ] && [ -t 0 ]; then
  echo "==> Chưa có .env — nhập nhanh để bắt đầu (Enter để bỏ qua, sửa $ENV_FILE sau):" >&2
  printf '    OPENAI_API_KEY (bắt buộc để chat hoạt động): ' >&2
  read -r dev_sh_api_key || true
  printf '    OPENAI_MODEL_ID (vd gpt-4o-mini — Enter để cấu hình sau): ' >&2
  read -r dev_sh_model_id || true
  {
    echo "OPENAI_API_KEY=$dev_sh_api_key"
    echo "OPENAI_BASE_URL="
    echo "OPENAI_MODEL_ID=$dev_sh_model_id"
    echo "OPENAI_EXTRA_BODY="
    echo "OPENAI_CONTEXT_WINDOW="
  } > "$ENV_FILE"
  if [ -z "$dev_sh_api_key" ]; then
    echo "    (chưa nhập OPENAI_API_KEY — chat sẽ báo lỗi thiếu credential tới khi bạn điền vào $ENV_FILE)" >&2
  fi
  echo "==> Đã lưu $ENV_FILE — sửa lại bất kỳ lúc nào rồi chạy lại ./scripts/dev.sh để áp dụng." >&2
fi

# Docker gets repo-root .env via docker-compose.yml's `env_file:` on the
# `core` service; this bare-host path has no equivalent, so source it here.
# entrypoint.sh itself stays untouched: it has no access to a repo-root .env
# when run inside a container (only data/harness/workspace are mounted), so
# env passthrough is correctly each boot path's own concern.
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

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
