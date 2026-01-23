# Claude Code WebUI - Project Context

> **Status**: Operational (2026-01-22)
> **Type**: Personal Tool
> **Health**: Fully functional

---

## What

Multi-session web dashboard for running Claude Code instances in browser tabs. Each tab spawns a `claude --dangerously-skip-permissions` session with:

- **Browser-like tab interface**: Multiple sessions, keyboard shortcuts (Ctrl+T, Ctrl+W)
- **Terminal UI**: xterm.js for authentic terminal look and feel
- **Screenshot uploads**: Upload images → get URLs → share with Claude
- **Session persistence**: Terminal content survives page refresh (history buffers)
- **Real-time streaming**: WebSocket-based communication

---

## Why

**Problem**: Running multiple Claude Code sessions requires multiple terminal windows, no easy way to share screenshots.

**Solution**: Web browser interface where each tab is a Claude Code session, with built-in screenshot hosting.

**Opportunity**: Faster workflow for multi-project development, easy screenshot sharing for vision tasks.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Client)                        │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌──────────────────────────────────┐  │
│  │Tab 1│ │Tab 2│ │Tab 3│ │ Sidebar (Screenshot Upload)       │  │
│  │xterm│ │xterm│ │xterm│ │ - Drag & drop                     │  │
│  │     │ │     │ │     │ │ - Auto-copy URL to clipboard      │  │
│  └─────┘ └─────┘ └─────┘ │ - 48-hour expiry (in-memory)     │  │
│         History Buffers   └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Node.js Express Server                       │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐  │
│  │  Session Mgr    │  │    Screenshot Service                │  │
│  │  - Map of PTYs  │  │    - In-memory storage (Map)        │  │
│  │  - History buf  │  │    - 48-hour TTL with cleanup       │  │
│  │  - WebSocket    │  │    - Serve via /uploads/:id route   │  │
│  └─────────────────┘  └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ node-pty.spawn()
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Claude Code CLI (--dangerously-skip-permissions)   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │Session 1│  │Session 2│  │Session 3│  │Session N│ ...         │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | xterm.js 5.3 + vanilla JS |
| Backend | Node.js + Express + ws (WebSocket) |
| Terminal | node-pty (spawns claude processes) |
| Storage | In-memory (Map) with TTL |
| Upload | multer (memory storage) |
| Deployment | Docker (port 3420) |

### Data Flow

1. **Create Session**: Browser → `create_session` → Server spawns PTY → Streams output via WebSocket
2. **User Input**: Browser → `send_input` → Server writes to PTY
3. **Tab Switch**: Browser → `attach_session` → Server sends history buffer
4. **Upload Screenshot**: Browser POST → Server stores in memory → Returns URL
5. **Screenshot Serve**: GET `/uploads/:id` → Server serves from memory → Deleted after 48h

---

## Current Implementation Status

### Working ✅
- [x] Multi-tab interface with xterm.js
- [x] WebSocket communication
- [x] PTY session spawning with `--dangerously-skip-permissions`
- [x] Session history buffers for refresh persistence
- [x] Screenshot upload with drag-and-drop
- [x] Auto-copy URL to clipboard
- [x] Keyboard shortcuts (Ctrl+T, Ctrl+W)
- [x] **In-memory screenshot storage** (48-hour TTL)
- [x] **Automatic cleanup of expired uploads**
- [x] **Settings loaded from container environment**
- [x] **Auto-theme selection** (no setup screen)
- [x] **Reliable tab close functionality**

### Completed Enhancements (2026-01-22)
- [x] Screenshot storage: Disk → **In-memory only**
- [x] Screenshot TTL: 1 hour → **48 hours**
- [x] Max uploads limit: **100 files**
- [x] Hourly cleanup interval for expired uploads
- [x] Container path mapping fixed (settings now load correctly)
- [x] Auto-theme selection (bypasses first-run wizard)
- [x] Tab close cleanup improved

---

## Related Files

- `/home/saunalserver/projects/claude-code-webui/server.js` - Main server
  - Lines 22-62: In-memory upload store with cleanup
  - Lines 242-352: Session creation with auto-theme selection
  - Lines 391-418: Improved session close handling
- `/home/saunalserver/projects/claude-code-webui/public/app.js` - Frontend logic
- `/home/saunalserver/projects/claude-code-webui/test-dashboard.js` - Browser automation tests
- `/home/saunalserver/projects/claude-code-webui/README.md` - Usage docs

---

## References

- **Project Location**: `/home/saunalserver/projects/claude-code-webui/`
- **Access**: http://100.96.197.39:3420 (Tailscale) or http://192.168.68.60:3420 (LAN)
- **Restart**: `./restart.sh` in project directory
