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
LLM_OPENAI_COMPAT_DIR="$REPO_ROOT/packages/llm/openai-compat"
TOOL_SERPER_DIR="$REPO_ROOT/packages/tool/serper-web-search"
TOOL_N8N_DIR="$REPO_ROOT/packages/tool/n8n"
TOOL_CREATE_SKILL_DIR="$REPO_ROOT/packages/tool/create-skill"
TOOL_GMAIL_BROWSER_DIR="$REPO_ROOT/packages/tool/gmail-browser"
PROFILE_DIR="$DSH_HOME/profiles/cordis-app"
DSH_BIN="$REPO_ROOT/node_modules/.bin/dsh"

# bundle-core's own cordis.patch.yml reads this to point
# dsh-skill-filesystem's bundledSkillDir at packages/skills — set here
# (not just scripts/dev.sh) so a Docker boot through THIS script directly
# also gets it, with the same default scripts/dev.sh already exports.
export CORDIS_BUNDLED_SKILL_DIR="${CORDIS_BUNDLED_SKILL_DIR:-$REPO_ROOT/packages/skills}"

mkdir -p "$PROFILE_DIR"
# The user-skill root, created here rather than by the first skill written into
# it. dsh-skill-filesystem attaches its watcher at boot; measured on a fresh
# deploy, the very first skill created through the API landed on disk but stayed
# invisible to ctx.skills.list() — /skill-content said "not found", edit said "no
# editable skill", and the duplicate-name guard (which reads the same list) let
# the same name be created twice. Later skills appeared in 27ms. The difference
# was this directory not existing when the watcher went looking.
mkdir -p "$DSH_HOME/skills"

# package.json is regenerated every start: the bundle list is composition
# (rebuild-tier), and every *_DIR's absolute path can change across images.
# Order matters for override layering (later entries win a shared id) —
# bundle-core's own tool-web/web overrides don't conflict with the 2 new
# packages' pure inserts, so their relative order doesn't matter here, but
# bundle-core stays first as the "app" bundle by convention.
cat > "$PROFILE_DIR/package.json" <<EOF
{
  "name": "dsh-profile-cordis-app",
  "private": true,
  "dependencies": {
    "@cordis-app/bundle-core": "link:$BUNDLE_DIR",
    "@cordis-app/llm-openai-compat": "link:$LLM_OPENAI_COMPAT_DIR",
    "@cordis-app/tool-serper-web-search": "link:$TOOL_SERPER_DIR",
    "@cordis-app/tool-n8n": "link:$TOOL_N8N_DIR",
    "@cordis-app/tool-create-skill": "link:$TOOL_CREATE_SKILL_DIR",
    "@cordis-app/tool-gmail-browser": "link:$TOOL_GMAIL_BROWSER_DIR"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@cordis-app/bundle-core",
        "@cordis-app/llm-openai-compat",
        "@cordis-app/tool-serper-web-search",
        "@cordis-app/tool-create-skill",
        "@cordis-app/tool-gmail-browser"
      ],
      "patchReload": "startup"
    }
  }
}
EOF
# @cordis-app/tool-n8n is deliberately NOT in the `bundles` array above — its
# own package.json has no dsh.bundle.patch at all (Config.baseURL is
# required with no universal default; every deployment's n8n instance
# differs). It's still LINKED as a dependency so it's resolvable the moment
# an operator opts in via a profile-level cordis.patch.yml row (see
# docs/patch-cookbook.md's n8n example) — without the link, that row would
# fail to import the package at all.

# cordis.yml and cordis.patch.yml are the user/data layer: created once,
# never overwritten again (cordis.patch.yml is where a human edits behavior
# from outside the container, per plan §7 — clobbering it on restart would
# silently discard that).
[ -f "$PROFILE_DIR/cordis.yml" ] || printf '[]\n' > "$PROFILE_DIR/cordis.yml"
[ -f "$PROFILE_DIR/cordis.patch.yml" ] || cp "$REPO_ROOT/deploy/profile-template/cordis-app/cordis.patch.yml" "$PROFILE_DIR/cordis.patch.yml"

cd "$REPO_ROOT"
# `dsh plugin ... install` alone is NOT enough for a bundle package that has
# never gone through `add` before: confirmed the hard way — hand-writing a
# new entry into package.json's own `bundles` array above and calling only
# `install` silently STRIPPED it back out (dsh tracks "known" bundles in its
# own internal state, separate from this file, and `install` reconciles
# against that state rather than trusting bundles it has never resolved via
# `add`). `add` is idempotent — a no-op after the first real run — so
# calling it for every one of our own bundles on every boot is cheap and
# makes a genuinely fresh $DSH_HOME (a new developer's machine, CI) work on
# the very first boot, not just this one that already has an `add` history.
"$DSH_BIN" plugin --profile cordis-app add "@cordis-app/bundle-core" >&2
"$DSH_BIN" plugin --profile cordis-app add "@cordis-app/llm-openai-compat" >&2
"$DSH_BIN" plugin --profile cordis-app add "@cordis-app/tool-serper-web-search" >&2
"$DSH_BIN" plugin --profile cordis-app add "@cordis-app/tool-n8n" >&2
"$DSH_BIN" plugin --profile cordis-app add "@cordis-app/tool-create-skill" >&2
"$DSH_BIN" plugin --profile cordis-app add "@cordis-app/tool-gmail-browser" >&2
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
# scripts/dev.sh (local, non-Docker use) sets SKIP_SOCAT=1 and points
# CORDIS_INTERNAL_PORT at the same value as CORDIS_PORT — no Docker means no
# published-port gap to bridge, so dsh just binds the port the browser opens
# directly. Without this guard, a developer who happens to have socat
# installed locally would race it against dsh for the same port.
if [ -z "${SKIP_SOCAT:-}" ] && command -v socat >/dev/null 2>&1; then
  socat "TCP-LISTEN:${CORDIS_PORT},bind=0.0.0.0,fork,reuseaddr" "TCP:127.0.0.1:${CORDIS_INTERNAL_PORT}" &
fi

exec "$DSH_BIN" --profile cordis-app --no-open --host 127.0.0.1 --port "$CORDIS_INTERNAL_PORT" "$@"
