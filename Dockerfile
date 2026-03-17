#
# Multi-stage Dockerfile for eTest UAT Agent
#

# =============================================================================
# Builder stage - Install dependencies and compile TypeScript
# =============================================================================
FROM node:22-slim AS builder

# Install build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./
COPY mcp-server/package*.json ./mcp-server/

# Install all dependencies (including devDependencies for TypeScript build)
RUN npm ci && \
    cd mcp-server && npm ci && cd ..

# Copy application source code
COPY . .

# Build TypeScript (mcp-server first, then main project)
RUN cd mcp-server && npm run build && cd .. && npm run build

# Remove devDependencies after build to reduce image size
RUN npm prune --production && \
    cd mcp-server && npm prune --production

# =============================================================================
# Runtime stage - Minimal production image
# =============================================================================
FROM node:22-slim AS runtime

# Install runtime dependencies: Chromium for Playwright, Claude Code CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    ca-certificates \
    # Chromium browser and dependencies for Playwright
    chromium \
    # Additional libraries Chromium needs
    libnss3 \
    libfreetype6 \
    libharfbuzz0b \
    # X11 libraries for headless browser
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    # Font rendering
    fontconfig \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user for security
RUN groupadd -g 1001 uat && \
    useradd -u 1001 -g uat -s /bin/bash -m uat

# Set working directory
WORKDIR /app

# Copy built artifacts and production dependencies from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/mcp-server/dist ./mcp-server/dist
COPY --from=builder /app/mcp-server/node_modules ./mcp-server/node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/mcp-server/package.json ./mcp-server/package.json
COPY --from=builder /app/configs ./configs
COPY --from=builder /app/prompts ./prompts

# Create directories for session data and ensure proper permissions
RUN mkdir -p /app/sessions /app/deliverables /app/audit-logs && \
    mkdir -p /tmp/.cache /tmp/.config /tmp/.npm && \
    chmod 777 /app && \
    chmod 777 /tmp/.cache && \
    chmod 777 /tmp/.config && \
    chmod 777 /tmp/.npm && \
    chown -R uat:uat /app

# Switch to non-root user
USER uat

# Set environment variables
ENV NODE_ENV=production
ENV PATH="/usr/local/bin:$PATH"
ENV ETEST_DOCKER=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV npm_config_cache=/tmp/.npm
ENV HOME=/tmp
ENV XDG_CACHE_HOME=/tmp/.cache
ENV XDG_CONFIG_HOME=/tmp/.config

# Configure Git identity and trust all directories
RUN git config --global user.email "agent@localhost" && \
    git config --global user.name "UAT Agent" && \
    git config --global --add safe.directory '*'

# Set entrypoint
CMD ["node", "dist/temporal/worker.js"]
