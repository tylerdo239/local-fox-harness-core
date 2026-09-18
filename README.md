# Cordis Agent Core

A single-user agent core built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) as an npm dependency (not a fork) — a thin `@cordis-app/bundle-core` plugin
bundle mounted on top of the stock `dsh-base`/`dsh-web-app` composition, plus a
standalone Next.js chat UI. See `docs/cordis-agent-architecture.md` for the
design and `docs/cordis-agent-implementation-plan.md` for what's actually
built and how it was verified.

## Prerequisites

- **Node 22.19+ or 24+** (`node -v` — dsh's own `engines` requirement). If your
  default `node` is older, install one via nvm (`nvm install 22 && nvm use 22`)
  or Homebrew (`brew install node@22`).
- **pnpm 11.7.0** (pinned in `packageManager`) — `corepack enable` picks it up
  automatically, or `npm install -g pnpm@11.7.0`.
- **Docker** — only needed for the containerized deploy path below, not for
  local dev.

## First-time setup

```sh
pnpm run setup   # = pnpm install && pnpm run build
```

## Run it locally (no Docker)

```sh
pnpm run dev
```

This always runs `pnpm install` + `pnpm run build` first (cheap when nothing
changed — a no-op install is ~200ms, a full rebuild a few seconds), so
**every restart boots the code actually on disk** — no separate "did I
rebuild?" step, whether it's your first run or you just pulled updates or
edited `packages/bundle-core/src/*.ts` / `apps/web/*`. Then it boots `dsh`
directly on `http://127.0.0.1:3080`.

The first boot log line looks like:

```
dsh web: http://127.0.0.1:3080/?token=<one-time-token>
```

Open that exact URL once in your browser — it exchanges the token for an
auth cookie, so plain `http://127.0.0.1:3080/` works after that. Stop with
`Ctrl-C`; state (sessions, credentials, settings) persists under
`.dev-state/` (gitignored, separate from Docker's `data/` so running both at
once never conflicts) between restarts.

### Set a model credential

No model call works until `OPENAI_API_KEY` (and ideally `OPENAI_MODEL_ID`) is
set — this app's own UI has no settings screen for these two (only
Serper/n8n credentials go through **Settings → Config**; the default
`@deepseek-ai/dsh-client-ui-settings-models` screen is disabled, see
`packages/bundle-core/cordis.patch.yml`'s header comment). Easiest path:
just run `pnpm run dev` (or `./scripts/dev.sh` directly) — on a fresh
checkout with no `.env` yet, it asks for both interactively on first run and
writes `.env` for you, so setup is still a single command. See
`docs/getting-started.md` for the full env var reference (all 5
`OPENAI_*` vars, Docker's `.env` passthrough, etc.) and
`docs/patch-cookbook.md` for adding other providers (OpenAI-compatible
gateways, self-hosted vLLM/Ollama/LM Studio, etc.) and enabling the n8n
integration.

### Picking up updates

```sh
git pull
pnpm run dev   # rebuilds and reboots with the new code, same as any restart
```

If a change bumped `@deepseek-ai/dsh-*` versions in `package.json` (see
"Upgrading dsh" in `docs/cordis-agent-implementation-plan.md` §10), `pnpm run
dev`'s unconditional `pnpm install` picks that up the same way — nothing
extra to run.

For a self-hosting end user (not a dev) updating a Docker deployment while
preserving their existing sessions/credentials/n8n data, see
`docs/upgrading.md` — same `git pull` mechanism, plus what does and doesn't
propagate automatically to an already-running install (package-tier
`cordis.patch.yml` changes do; the profile-tier one, materialized once on
first boot, doesn't).

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm run dev` | Install + build + boot locally on `:3080` |
| `pnpm run build` | Build every `packages/*` package then `apps/web` (no boot) |
| `pnpm run typecheck` | `tsc --noEmit` on every package, no build output |
| `pnpm --dir apps/web run dev` | Next.js dev server alone (UI iteration without a live gateway — API calls will fail with no backend) |

## Run it in Docker

```sh
docker compose -f deploy/docker-compose.yml up --build
```

Same boot script (`deploy/entrypoint.sh`) as local dev, parameterized for a
container instead: binds loopback-only inside the container and bridges to
the published port via `socat` (Docker Desktop doesn't forward a published
port to a container-loopback-only listener — see the comment in
`entrypoint.sh` for the real failure this works around). State lives in
`data/harness` (bind mount, edit `data/harness/profiles/cordis-app/
cordis.patch.yml` from the host + `docker compose restart core` to change
composition without rebuilding — see `docs/patch-cookbook.md`).

## Project layout

```
packages/bundle-core/            # our own app bundle — ui, auth, gateway, n8n, audit (1 file per concern)
packages/llm/openai-compat/      # generic OpenAI-compatible LlmAdapter (own package, own cordis.patch.yml)
packages/tool/serper-web-search/ # Serper.dev search source for dsh-tool-web (own package)
apps/web/                        # Next.js static-export chat UI, served by cordis-ui
deploy/                          # entrypoint.sh (shared by local dev and Docker), Dockerfile, compose
docs/                            # architecture doc, implementation plan, patch cookbook, UI clone plan, getting-started, upgrading
scripts/dev.sh                   # local (non-Docker) dev runner — see "Run it locally" above
```

`packages/bundle-core` stays one package with one file per concern — there's
one deployment target for the app itself and no reuse-across-teams need for
that glue code, so the extra package/version bookkeeping wouldn't pay for
itself. `packages/llm/` and `packages/tool/` are grouped-category folders
(`packages/<group>/<name>`, same convention this project's own reference UI
design — example-2 — uses once a category has more than one member): each
subfolder is its own real npm workspace package with its own
`cordis.patch.yml`, listed explicitly in `deploy/entrypoint.sh`'s
`dsh.profile.bundles` array (a package's own patch.yml is not picked up
just by existing — it has to be named there). Neither declares
`@deepseek-ai/dsh-*` as its own dependency (only a `peerDependencies` entry
for `@deepseek-ai/cordis`) — those resolve through the single root
`node_modules` instead, same as `bundle-core` already does; see either
package's own `comment_dependencies` field for the real duplicate-identity
bug this avoids. General-purpose tools (bash, file read/write/search, web
fetch, skills) still come from `dsh-base` itself, not from anything in this
repo — only the LLM adapter and the web-search source above are ours.
