# Claude Code WebUI

Multi-session web interface for Claude Code with `--dangerously-skip-permissions` support.

## Features

- **Multi-Session Dashboard**: Run multiple Claude Code sessions simultaneously
- **Per-Tab Isolation**: Each browser tab spawns a fresh `claude --dangerously-skip-permissions` session
- **Session Persistence**: Sessions continue running on server, browser can reconnect
- **Real-time Streaming**: WebSocket-based real-time communication
- **Clean UI**: Dark-themed interface inspired by modern terminal emulators

## Quick Start

### Local Development

```bash
cd /home/saunalserver/projects/claude-code-webui
npm install
npm start
```

Access at: http://localhost:3420

### Docker Deployment

```bash
cd /home/saunalserver/projects/claude-code-webui
docker-compose up -d
```

Access at: http://localhost:3420

### Tailscale Access

The server binds to `0.0.0.0`, so it's accessible via Tailscale:

http://100.96.197.39:3420

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
