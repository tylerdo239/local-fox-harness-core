# Cordis Agent Core — one image, one process (architecture doc §2.1/§8.1).
# Thin fork of dsh (npm dependency on @deepseek-ai/dsh + the individual
# @deepseek-ai/dsh-* packages this bundle imports — see
# docs/cordis-agent-implementation-plan.md §0 for why this replaced an
# earlier git-clone-of-the-whole-monorepo approach), so this build no longer
# needs to compile dsh itself — only our own small packages (bundle-core,
# plus the cloned llm/openai-compat + tool/serper-web-search plugins, plus
# our own original tool/n8n).
#
# Two stages because apps/web is a deliberately standalone pnpm project (own
# pnpm-workspace.yaml — mixing its React 19 into the root workspace is not
# even possible here since dsh's own packages have no React dependency to
# conflict with, but keeping the frontend's install/build fully independent
# avoids ever coupling its dependency resolution to the backend's).
FROM node:22-bookworm-slim AS web-builder
WORKDIR /web
COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate \
 && pnpm install --frozen-lockfile
COPY apps/web/ ./
RUN pnpm run build

FROM node:22-bookworm-slim AS core-builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/bundle-core/package.json packages/bundle-core/
COPY packages/llm/openai-compat/package.json packages/llm/openai-compat/
COPY packages/tool/serper-web-search/package.json packages/tool/serper-web-search/
COPY packages/tool/n8n/package.json packages/tool/n8n/
COPY packages/tool/create-skill/package.json packages/tool/create-skill/
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate \
 && pnpm install --frozen-lockfile
COPY packages/bundle-core/ packages/bundle-core/
COPY packages/llm/openai-compat/ packages/llm/openai-compat/
COPY packages/tool/serper-web-search/ packages/tool/serper-web-search/
COPY packages/tool/n8n/ packages/tool/n8n/
COPY packages/tool/create-skill/ packages/tool/create-skill/
COPY packages/skills/ packages/skills/
RUN pnpm --dir packages/llm/openai-compat run build \
 && pnpm --dir packages/tool/serper-web-search run build \
 && pnpm --dir packages/tool/n8n run build \
 && pnpm --dir packages/tool/create-skill run build \
 && pnpm --dir packages/bundle-core run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# `dsh plugin ... install` (entrypoint.sh) shells out to pnpm at container
# start, not just build time. socat: entrypoint.sh's 0.0.0.0-reachable proxy
# in front of dsh's own loopback-only listener (see entrypoint.sh for why —
# confirmed necessary against a real Docker Desktop run, not a guess).
#
# python3 + numpy + pandas because the image had no interpreter at all: asked
# to count the primes under 100000, the agent called `python3` (not found),
# then `python` (not found), then probed with `which python3 python perl ruby`
# and fell back to writing Perl — three wasted steps before any real work, on
# an agent whose main job is analysing data. Installed from apt rather than
# pip so the build stays offline-deterministic and compiles nothing.
RUN npm install --global pnpm@11.7.0 && npm cache clean --force \
 && apt-get update && apt-get install --no-install-recommends -y \
      socat python3 python3-numpy python3-pandas \
 && rm -rf /var/lib/apt/lists/*
COPY --from=core-builder /app /app
COPY --from=web-builder /web/out /app/apps/web/out
COPY deploy/ deploy/
ENV DSH_HOME=/data/harness
ENV CORDIS_WORKSPACE_ROOT=/workspace
EXPOSE 3080
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
