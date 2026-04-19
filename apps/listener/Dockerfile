FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@latest --activate

# ── Builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# Copy shared packages + listener source
COPY packages/shared  packages/shared
COPY packages/db      packages/db
COPY apps/listener    apps/listener

RUN pnpm install --frozen-lockfile

# Build in dependency order
RUN pnpm --filter @dialer/shared   build
RUN pnpm --filter @dialer/db       build
RUN pnpm --filter @dialer/listener build

# ── Production runner ─────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Manifests for pnpm prod install
COPY --from=builder /app/package.json            ./
COPY --from=builder /app/pnpm-lock.yaml          ./
COPY --from=builder /app/pnpm-workspace.yaml     ./
COPY --from=builder /app/packages/shared/package.json   ./packages/shared/
COPY --from=builder /app/packages/db/package.json       ./packages/db/
COPY --from=builder /app/apps/listener/package.json     ./apps/listener/

RUN pnpm install --prod --frozen-lockfile 2>/dev/null || pnpm install --frozen-lockfile

# Copy compiled output
COPY --from=builder /app/packages/shared/dist   ./packages/shared/dist
COPY --from=builder /app/packages/db/dist       ./packages/db/dist
COPY --from=builder /app/apps/listener/dist     ./apps/listener/dist

EXPOSE 3001
CMD ["node", "apps/listener/dist/index.js"]
