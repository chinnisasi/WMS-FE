# syntax=docker/dockerfile:1
#
# Story 6-2a — the wms-fe production image (decision 8). Bun installs and
# builds; the Next `standalone` server runs on Node (Next's standalone
# server targets Node). ONE image serves every environment: the browser's API
# base is read at run time from WMS_API_BASE_URL (served as
# /runtime-config.js), never baked in at build time.
#
#   docker run -p 3001:3001 -e WMS_API_BASE_URL=https://api.example/api/v1 wms-fe

ARG BUN_VERSION=1.4.2
ARG NODE_VERSION=22

FROM oven/bun:${BUN_VERSION}-alpine AS bun

# ── build: Bun installs (frozen lockfile) and runs `next build` on Node ─────
# Both stages are Alpine (musl), so the platform packages Bun picks — @next/swc
# and sharp's musl builds — are the ones the runtime stage loads.
FROM node:${NODE_VERSION}-alpine AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# ── runtime: the traced standalone server, non-root ─────────────────────────
FROM node:${NODE_VERSION}-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

# Non-root: the base image's `node` user (uid 1000).
USER node
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/runtime-config.js').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
