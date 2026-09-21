# ==============================================================================
# Stage 1: Build & Compile Assets
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies with frozen lockfile
COPY package.json package-lock.json ./
RUN npm ci

# Copy source files
COPY . .

# Build frontend and server
RUN npm run build:all

# Prune devDependencies to keep production image minimal
RUN npm prune --omit=dev

# ==============================================================================
# Stage 2: Minimal Production Runtime
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production \
    PORT=3000

# Create unprivileged application user & group (UID/GID 10001)
RUN addgroup -g 10001 -S launchpad && \
    adduser -u 10001 -S launchpad -G launchpad

# Copy production dependencies and compiled artifacts
COPY --from=builder --chown=launchpad:launchpad /app/package.json ./package.json
COPY --from=builder --chown=launchpad:launchpad /app/node_modules ./node_modules
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
CMD ["node", "dist-server/index.mjs"]
