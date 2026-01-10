# ─────────────────────────────────────────────────────────────
# Antigravity Quota Refresher - Production Dockerfile
# ─────────────────────────────────────────────────────────────
# 
# SECURITY NOTES:
# - Token MUST be passed via environment variable, never baked into image
# - Uses alpine for minimal attack surface (~150MB)
# - Runs as non-root user
#
# BUILD:   docker build -t antigravity-refresher .
# RUN:     docker run -e ANTIGRAVITY_REFRESH_TOKEN="your_token" antigravity-refresher
# ─────────────────────────────────────────────────────────────

FROM node:22-alpine

# Security: Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Dependencies first (Docker layer caching)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Application code
COPY src ./src

# Security: Switch to non-root user
USER appuser

# Default: start scheduler (reads TRIGGER_TIME from env var)
ENV NODE_ENV=production

ENTRYPOINT ["node"]
CMD ["src/index.js"]
