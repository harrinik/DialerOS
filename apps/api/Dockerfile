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

# Debug: show where server.js landed so we can verify the path used in CMD
RUN echo "=== Standalone output ===" \
    && find apps/api/.next/standalone -name "server.js" -maxdepth 5 2>/dev/null \
    && echo "=== .next top-level ===" \
    && ls -la apps/api/.next/ 2>/dev/null \
    || echo "(standalone dir not found)"

# Ensure public dir exists — Next.js public/ is optional but COPY requires source
RUN mkdir -p apps/api/public

# ── Production image ───────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install ffmpeg for audio conversion (ffmpeg-static binary is not
# preserved in Next.js standalone output, so we need the system package)
RUN apk add --no-cache ffmpeg

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the full standalone bundle (self-contained, includes bundled node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/apps/api/.next/standalone ./

# Copy static assets and public dir
COPY --from=builder --chown=nextjs:nodejs /app/apps/api/.next/static ./apps/api/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/api/public        ./apps/api/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Find server.js at runtime — handles both:
#   /app/server.js                    (flat output, no outputFileTracingRoot)
#   /app/apps/api/server.js           (monorepo-aware output)
CMD ["sh", "-c", "node $(find /app -maxdepth 4 -name 'server.js' 2>/dev/null | head -1)"]
