# Claude Code WebUI - Quick Reference

---

## Commands

### Startup / Shutdown

```bash
# Safe restart (recommended)
cd /home/saunalserver/projects/claude-code-webui
./restart.sh

# Manual: Stop, rebuild, start
docker compose down
docker compose up -d --build

# View logs
docker logs claude-code-webui --tail 100 -f

# Check status
docker compose ps
```

### Local Development

```bash
cd /home/saunalserver/projects/claude-code-webui
npm install
npm run dev  # Auto-restart on file changes
```

---

## Access

| Method | URL |
|--------|-----|
| Tailscale | http://100.96.197.39:3420 |
| Local LAN | http://192.168.68.60:3420 |
| Localhost | http://localhost:3420 |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New terminal session |
| `Ctrl+W` | Close current tab |
| Click sidebar toggle | Collapse/expand sidebar |

---

## File Structure

```
claude-code-webui/
├── server.js           # Express + WebSocket server (main file)
├── package.json        # Dependencies
├── Dockerfile          # Container image
├── docker-compose.yml  # Deployment config
├── restart.sh          # Safe restart script
├── uploads/            # Deprecated (old disk storage, will remove)
└── public/
    ├── index.html      # Main UI
    ├── style.css       # Dark theme
    └── app.js          # WebSocket client + UI logic
```

---

## Key Code Locations

| Feature | File | Lines |
|---------|------|-------|
| Upload endpoint | server.js | 84-106 |
| Upload storage | server.js | 31-55 (TODO: migrate) |
| Session creation | server.js | 188-301 |
| WebSocket handler | server.js | 131-186 |
| Frontend upload | public/app.js | 414-521 |
| Tab management | public/app.js | 247-329 |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve index.html |
| GET | `/health` | Active sessions count |
| GET | `/api/sessions` | List all sessions |
| POST | `/api/upload` | Upload screenshot (returns URL) |
| GET | `/api/uploads` | List recent uploads |
| GET | `/uploads/:id` | Serve uploaded image |
| WS | `/` | WebSocket for terminal I/O |

---

## WebSocket Messages

### Client → Server

```javascript
// Create new session
{ type: 'create_session', payload: { cwd: '/home/saunalserver' } }

// Send input to terminal
{ type: 'send_input', payload: { sessionId: 'term-...', input: 'ls\n' } }

// Attach to existing session
{ type: 'attach_session', payload: { sessionId: 'term-...' } }

// Resize terminal
{ type: 'resize_session', payload: { sessionId: 'term-...', cols: 80, rows: 24 } }

// Close session
{ type: 'close_session', payload: { sessionId: 'term-...' } }
```

### Server → Client

```javascript
// Initial state
{ type: 'init', payload: { sessions: [...], uploads: [...] } }

// Session created
{ type: 'session_created', payload: { id: 'term-...', cwd: '...', status: 'running' } }

// Terminal output
{ type: 'output', payload: { sessionId: 'term-...', data: '...' } }

// Session ended
{ type: 'session_ended', payload: { sessionId: 'term-...', exitCode: 0 } }

// Attachment confirmed with history
{ type: 'attached', payload: { sessionId: 'term-...', history: [...] } }
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3420 | Server port |
| `PUBLIC_URL` | `http://100.96.197.39:PORT` | Base URL for screenshot links |
| `HOME` | (system) | Passed to Claude Code PTY |

---

## Troubleshooting

### Port not accessible
```bash
# Check what's using port 3420
ss -tlnp | grep 3420

# Kill process if needed
kill -9 <PID>

# Restart container
./restart.sh
```

### Container restarting loop
```bash
# Check logs
docker logs claude-code-webui --tail 100

# Common issues:
# - Missing dependencies → npm install
# - Port conflict → kill competing process
# - Permission error → check file ownership
```

### Tab switching glitches
- Usually fixed by page refresh (Ctrl+R)
- If persistent, check browser console for errors

### Screenshots not loading
- Check network tab in DevTools
- Verify `/uploads/:id` endpoint returns 200
- Check memory store has the upload

---

## Dependencies

```json
{
  "express": "^4.18.2",      // Web server
  "ws": "^8.14.2",           // WebSocket
  "node-pty": "^1.0.0",      // PTY spawning
  "multer": "^1.4.5",        // File uploads
  "uuid": "^9.0.1",          // UUID generation
  "xterm": "^5.3.0",         // Terminal emulation (frontend)
  "xterm-addon-fit": "^0.8.0" // Auto-resize (frontend)
}
```

---

## Project Links

- **NEXUS Context**: `/home/saunalserver/projects/claude-code-webui/nexus/CONTEXT.md`
- **Implementation Plan**: `/home/saunalserver/projects/claude-code-webui/nexus/PLAN.md`
- **Global Blockers**: `/home/saunalserver/obsidian-vault/nexus/99_ACTIVE/BLOCKING.md`
