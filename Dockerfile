# syntax=docker/dockerfile:1
#
# Story 6-2a — the wms-fe production image (decision 8). Bun installs and
# builds; the Next `standalone` server runs on Node (Next's standalone
# server targets Node). ONE image serves every environment: the browser's API
# base is read at run time from WMS_API_BASE_URL (served as
# /runtime-config.js), never baked in at build time.
#
#   docker run -p 3001:3001 -e WMS_API_BASE_URL=https://api.example/api/v1 wms-fe
#
# Story 6-2c (decision 9, A19): every base image is pinned to its multi-arch
# index digest — a mutable tag can no longer change what a rebuild runs. The
# tags stay beside the digests for the reader (the Bun tag must equal
# .bun-version, the Node one is 22-alpine — scripts/dockerfile.test.ts);
# Dependabot proposes digest refreshes weekly.
#
# Exit codes (story 6-2c, A18): 0 graceful stop · 78 a bad WMS_API_BASE_URL
# or WEB_SHUTDOWN_FORCE_EXIT_MS · 75 the 25 s drain bound · 130 SIGINT.
# Writable at run time: /tmp and /app/.next/cache (the image runs under
# `--read-only --tmpfs /tmp --tmpfs /app/.next/cache:uid=1000,gid=1000`).

FROM oven/bun:1.4.2-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS bun

# ── build: Bun installs (frozen lockfile) and runs `next build` on Node ─────
# Both stages are Alpine (musl), so the platform packages Bun picks — @next/swc
# and sharp's musl builds — are the ones the runtime stage loads.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# ── runtime: the traced standalone server, non-root ─────────────────────────
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /app
# KEEP_ALIVE_TIMEOUT (story 6-2c, decision 3): Next's standalone server.js
# reads it — idle sockets are kept 65 s, above the ALB's 60 s idle timeout,
# so the ALB never reuses a socket the web just closed (an intermittent 502).
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0 \
    KEEP_ALIVE_TIMEOUT=65000

# Story 6-2c (decision 10): the code is ROOT-owned — the runtime user runs it,
# never rewrites it. Only Next's cache directory belongs to `node` (no ISR
# writes exist: scripts/no-revalidate.test.ts).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Code review C6: the start refuses an unset or non-http(s) WMS_API_BASE_URL;
# story 6-2c: it also bounds the SIGTERM drain.
COPY --from=build /app/scripts/start-standalone.mjs ./start-standalone.mjs
RUN mkdir -p .next/cache && chown node:node .next/cache

# Non-root: the base image's `node` user (uid 1000).
USER node
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/runtime-config.js').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "start-standalone.mjs"]
