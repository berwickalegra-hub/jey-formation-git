# Multi-stage build for the Next.js 16 frontend.
#
#   Stage 1 (builder):  install deps, run `next build` (standalone output).
#   Stage 2 (runtime):  copy the standalone server + static assets.
#
# Build with: docker build -f frontend/Dockerfile -t myapp-frontend .

FROM node:20-bookworm-slim AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN pnpm install --frozen-lockfile --ignore-scripts --filter frontend...

COPY frontend/ frontend/
RUN pnpm --filter frontend run build

# ───────────────────────────── Runtime ─────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 app \
  && useradd  --system --uid 1001 --gid 1001 --shell /usr/sbin/nologin app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Next.js standalone output puts a self-contained server.js + minimal
# node_modules in .next/standalone. Static assets live in .next/static
# (need to be copied alongside) and public/ files (if any).
COPY --from=builder /repo/frontend/.next/standalone ./
COPY --from=builder /repo/frontend/.next/static ./.next/static
COPY --from=builder /repo/frontend/public ./public

USER app
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "frontend/server.js"]
