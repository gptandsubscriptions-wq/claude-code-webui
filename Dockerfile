FROM node:20-slim

# Install build dependencies for node-pty and runtime dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user for running claude (required for --dangerously-skip-permissions)
# Use saunalserver user with UID 1000 to match host
RUN deluser node && \
    useradd -m -u 1000 -s /bin/bash saunalserver && \
    mkdir -p /home/saunalserver/projects/claude-code-webui && \
    chown -R saunalserver:saunalserver /home/saunalserver

# Set working directory for the app
WORKDIR /home/saunalserver/projects/claude-code-webui

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies (as root, then chown)
RUN npm ci --only=production && \
    chown -R saunalserver:saunalserver /home/saunalserver/projects/claude-code-webui

# Copy application files
COPY --chown=saunalserver:saunalserver . .

# Switch to non-root user
USER saunalserver

# Expose port
EXPOSE 3420

# Set default environment (now using consistent paths)
ENV PORT=3420
ENV NODE_ENV=production
ENV HOME=/home/saunalserver
ENV USER=saunalserver

# Start the server
CMD ["npm", "start"]
