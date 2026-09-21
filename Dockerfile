# ==============================================================================
# Stage 1: Build & Compile Assets
# ==============================================================================
FROM oven/bun:alpine AS builder

WORKDIR /app

# Install dependencies with frozen lockfile
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

# Copy application source
COPY . .

# Build frontend production bundle and self-contained server bundle
RUN bun run build

# ==============================================================================
# Stage 2: Minimal Production Runtime
# ==============================================================================
FROM oven/bun:alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production \
    PORT=3000

# Create unprivileged application user & group (UID/GID 10001)
RUN addgroup -g 10001 -S launchpad && \
    adduser -u 10001 -S launchpad -G launchpad

# Copy compiled artifacts (server is fully self-contained, no node_modules required)
COPY --from=builder --chown=launchpad:launchpad /app/package.json ./package.json
COPY --from=builder --chown=launchpad:launchpad /app/dist ./dist
COPY --from=builder --chown=launchpad:launchpad /app/dist-server ./dist-server

# Expose service port
EXPOSE 3000

# Container healthcheck against backend health endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Switch to non-root user
USER 10001:10001

# Start production server
CMD ["bun", "dist-server/index.js"]
