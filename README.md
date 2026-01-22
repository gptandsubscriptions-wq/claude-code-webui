# Claude Code WebUI

Multi-session web interface for Claude Code with `--dangerously-skip-permissions` support.

## Features

- **Multi-Session Dashboard**: Run multiple Claude Code sessions simultaneously
- **Per-Tab Isolation**: Each browser tab spawns a fresh `claude --dangerously-skip-permissions` session
- **Session Persistence**: Sessions continue running on server, browser can reconnect
- **Real-time Streaming**: WebSocket-based real-time communication
- **Clean UI**: Dark-themed interface inspired by modern terminal emulators

## Quick Start

### Docker Deployment (Recommended)

**Safe restart (ensures clean state):**
```bash
cd /home/saunalserver/projects/claude-code-webui
./restart.sh
```

**Or manual:**
```bash
cd /home/saunalserver/projects/claude-code-webui
docker compose down  # Ensures clean state
docker compose up -d --build
```

Access at: http://localhost:3420 or http://100.96.197.39:3420 (Tailscale)

### Local Development

```bash
cd /home/saunalserver/projects/claude-code-webui
npm install
npm start
```

Access at: http://localhost:3420

## Troubleshooting

**Site not loading (port 3420 not accessible):**
```bash
# Check container status
docker compose ps

# If ports column is empty, container lost its port mapping. Fix with:
./restart.sh

# Or manually:
docker compose down
docker compose up -d --build
```

**Container keeps restarting:**
```bash
# Check logs
docker logs claude-code-webui --tail 100

# Common issues:
# - Port 3420 already in use: kill the process using it
ss -tlnp | grep 3420
# Then kill the PID shown
```

**Tab switching glitches:**
- Fixed in latest version - each tab now has its own DOM container
- Try reloading the page if issues persist

## Usage

1. Open the web interface
2. Click **"+ New Terminal"** to spawn a new Claude Code session
3. Each session runs with `--dangerously-skip-permissions` (auto-approves tools)
4. Switch between sessions using the tabs
5. Sessions persist even if you close the browser

## Architecture

```
┌─────────────┐     WebSocket     ┌─────────────┐
│   Browser   │ ◄──────────────► │   Node.js   │
│   (Tabs)    │                   │   Server    │
└─────────────┘                   └──────┬──────┘
                                          │
                                          │ spawns
                                          ▼
                                  ┌──────────────┐
                                  │   Claude     │
                                  │   Code CLI   │
                                  │  (--dangerous)│
                                  └──────────────┘
```

## Project Structure

```
claude-code-webui/
├── server.js           # WebSocket server & Claude Code spawner
├── package.json        # Dependencies
├── Dockerfile          # Container image
├── docker-compose.yml  # Deployment config
└── public/
    ├── index.html      # Frontend UI
    ├── style.css       # Dark theme styles
    └── app.js          # WebSocket client & UI logic
```

## Configuration

Environment variables:
- `PORT`: Server port (default: 3420)

## License

MIT
