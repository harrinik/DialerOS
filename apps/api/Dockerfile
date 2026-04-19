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

# Debug: show what standalone produced so we can fix path issues
RUN echo "=== standalone contents ===" \
    && find apps/api/.next/standalone -maxdepth 3 -name "server.js" 2>/dev/null \
    || echo "WARNING: no server.js found in standalone"

# Locate server.js (monorepo root vs nested) and normalise to one location.
# outputFileTracingRoot=../../ causes Next 14 to emit:
#   apps/api/.next/standalone/apps/api/server.js  (monorepo-aware path)
# Without it Next falls back to:
#   apps/api/.next/standalone/server.js
RUN SERVER_JS=$(find apps/api/.next/standalone -name "server.js" -maxdepth 4 2>/dev/null | head -1) \
    && if [ -z "$SERVER_JS" ]; then \
         echo "ERROR: Next.js standalone build not produced."; \
         echo "  Ensure next.config.ts has:  output: 'standalone'"; \
         echo "  and outputFileTracingRoot set to path.join(__dirname, '../../')"; \
         exit 1; \
       fi \
    && echo "Found server.js at: $SERVER_JS"

# Ensure public dir exists so COPY never fails (Next.js public is optional)
RUN mkdir -p apps/api/public

# ── Production image ───────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the entire standalone bundle (contains server.js + bundled node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/apps/api/.next/standalone ./

# Copy static assets
COPY --from=builder --chown=nextjs:nodejs /app/apps/api/.next/static ./apps/api/.next/static

# Copy public dir (always exists due to mkdir above)
COPY --from=builder --chown=nextjs:nodejs /app/apps/api/public ./apps/api/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Dynamically find server.js to handle both monorepo and root placement:
#   /app/apps/api/server.js   (with outputFileTracingRoot)
#   /app/server.js            (without outputFileTracingRoot)
CMD ["sh", "-c", "node $(find /app -maxdepth 4 -name 'server.js' 2>/dev/null | head -1)"]
