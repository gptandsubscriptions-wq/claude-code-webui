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
# Remove existing node user and create claude user with UID 1000 to match host
RUN deluser node && \
    useradd -m -u 1000 -s /bin/bash claude && \
    mkdir -p /home/claude/projects/claude-code-webui && \
    chown -R claude:claude /home/claude

# Set working directory for the app
WORKDIR /home/claude/projects/claude-code-webui

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies (as root, then chown)
RUN npm ci --only=production && \
    chown -R claude:claude /home/claude/projects/claude-code-webui

# Copy application files
COPY --chown=claude:claude . .

# Switch to non-root user
USER claude

# Expose port
EXPOSE 3420

# Set default environment
ENV PORT=3420
ENV NODE_ENV=production
ENV HOME=/home/claude

# Start the server
CMD ["npm", "start"]
