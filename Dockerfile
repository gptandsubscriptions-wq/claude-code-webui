FROM node:20-alpine

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Expose port
EXPOSE 3420

# Set default environment
ENV PORT=3420
ENV NODE_ENV=production

# Start the server
CMD ["npm", "start"]
