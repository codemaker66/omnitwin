# syntax=docker/dockerfile:1.7
# -----------------------------------------------------------------------------
# OMNITWIN API — multi-stage Dockerfile
#
# Stage 1 (deps)    — install all deps with pnpm (cached when lockfile unchanged)
# Stage 2 (build)   — build @omnitwin/types then @omnitwin/api
# Stage 3 (runtime) — slim node:22-alpine with only prod deps + compiled JS
#
# Runtime uses a non-root user, exposes PORT 3001 by default (Railway sets
# its own PORT env), and embeds a HEALTHCHECK that hits /health/live — the
# K8s-convention liveness alias we wired into the Fastify instance.
#
# tini is PID 1 so SIGTERM from the orchestrator forwards to Node. The
# graceful-shutdown handler in src/index.ts depends on receiving SIGTERM;
# without tini, Node would sometimes receive SIGKILL after Docker's
# 10-second default grace.
# -----------------------------------------------------------------------------

ARG NODE_VERSION=22.12.0
ARG PNPM_VERSION=9.15.4

# -----------------------------------------------------------------------------
# Stage 1 — dependencies
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN npm install -g pnpm@${PNPM_VERSION}

# Copy only the files needed for `pnpm install` first — this layer is
# cache-hit whenever the lockfile hasn't changed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/types/package.json ./packages/types/
COPY packages/api/package.json ./packages/api/
# web's package.json is required because pnpm-workspace.yaml references it.
COPY packages/web/package.json ./packages/web/

# --ignore-scripts skips the root postinstall (types build), which we
# rerun in the build stage with source files available.
# NOTE: No BuildKit --mount=type=cache here. Railway rejects cache mount
# ids that aren't prefixed with its `s/<service>-…` key scheme, and that
# prefix isn't known at Dockerfile-write time. The tradeoff is a slower
# cold build; docker layer caching still kicks in when the lockfile
# hasn't changed.
RUN pnpm install --frozen-lockfile --ignore-scripts

# -----------------------------------------------------------------------------
# Stage 2 — build
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN npm install -g pnpm@${PNPM_VERSION}

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/types ./packages/types
COPY packages/api ./packages/api

# Build @omnitwin/types first (dependency of api), then @omnitwin/api.
RUN pnpm --filter @omnitwin/types build \
 && pnpm --filter @omnitwin/api build

# Prune dev deps; `pnpm deploy` produces a self-contained directory
# with only production deps resolved.
RUN pnpm --filter @omnitwin/api --prod deploy /app/deploy

# -----------------------------------------------------------------------------
# Stage 3 — runtime
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime

RUN apk add --no-cache tini wget

WORKDIR /app

RUN addgroup -S omnitwin && adduser -S -G omnitwin omnitwin

COPY --from=build --chown=omnitwin:omnitwin /app/deploy ./

USER omnitwin

ENV NODE_ENV=production \
    PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:${PORT:-3001}/health/live || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
