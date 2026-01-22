#!/bin/bash
# Safe restart script for claude-code-webui
# This ensures clean state and proper port mapping

set -e

echo "Stopping claude-code-webui..."
docker compose down 2>/dev/null || true

echo "Removing orphaned container..."
docker rm -f claude-code-webui 2>/dev/null || true

echo "Building and starting..."
docker compose up -d --build

echo "Waiting for service to be ready..."
for i in {1..30}; do
    if curl -s -f http://localhost:3420 > /dev/null 2>&1; then
        echo "Service is ready!"
        echo "Access at: http://100.96.197.39:3420"
        docker compose ps
        exit 0
    fi
    sleep 1
done

echo "ERROR: Service did not become ready in time"
docker logs claude-code-webui --tail 50
exit 1
