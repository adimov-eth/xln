# XLN Production Docker Image
FROM oven/bun:1.2.9-alpine

# Install dependencies for better container handling
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    tini

# Create app user
RUN addgroup -g 1001 -S xln && \
    adduser -u 1001 -S xln -G xln

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src/ ./src/
COPY deploy/ ./deploy/

# Create data directories
RUN mkdir -p /app/data /app/logs && \
    chown -R xln:xln /app

# Switch to non-root user
USER xln

# Expose ports
EXPOSE 8080 9090

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD bun run healthcheck.ts || exit 1

# Use tini to handle signals properly
ENTRYPOINT ["/sbin/tini", "--"]

# Start the server
CMD ["bun", "run", "src/server/XLNServer.ts"]