FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@latest --activate

# ── Builder ───────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Copy workspace manifests first (layer caching)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# Copy shared packages and API source
COPY packages/shared packages/shared
COPY packages/db     packages/db
COPY apps/api        apps/api

# Install ALL workspace deps (needed for cross-package TypeScript resolution)
RUN pnpm install --frozen-lockfile

# Build shared packages first, then the Next.js app
RUN pnpm --filter @dialer/shared build
RUN pnpm --filter @dialer/db     build
RUN pnpm --filter @dialer/api    build

# Verify the standalone build was produced (fails fast with a clear message)
RUN test -f apps/api/.next/standalone/apps/api/server.js \
    || test -f apps/api/.next/standalone/server.js \
    || (echo "ERROR: Next.js standalone build not found. Ensure next.config.ts has output: 'standalone'" && exit 1)

# Ensure public dir always exists (Next.js doesn't require it, but COPY needs source)
RUN mkdir -p apps/api/public

# ── Production image ───────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy standalone build output
# In a pnpm monorepo, Next.js places server.js at the repo root inside standalone
COPY --from=builder --chown=nextjs:nodejs /app/apps/api/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/api/.next/static      ./apps/api/.next/static

# Copy public dir — always exists because builder stage mkdir'd it
COPY --from=builder --chown=nextjs:nodejs /app/apps/api/public ./apps/api/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# server.js lives at apps/api/server.js inside the standalone output
CMD ["node", "apps/api/server.js"]
