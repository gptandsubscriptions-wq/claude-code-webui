# Claude Code WebUI - Lessons Learned

---

## Architecture Lessons

### Terminal State Management
**Lesson**: Each tab needs its own DOM container for xterm.js, not reusing a single container.

**Why**: When switching tabs, xterm.js would glitch because the same DOM element was being reused. Creating dedicated containers per session solved this.

**Code**: See `public/app.js:140-218` (createTerminal function)

### Session History Buffers
**Lesson**: Store terminal output in memory (max 100KB) for session persistence across page refreshes.

**Why**: Users expect Ctrl+R to restore their session context. Without history buffers, they'd lose all output.

**Code**: See `server.js:245-264` (history array + historySize tracking)

---

## Docker Lessons

### Port Mapping Issues
**Symptom**: Container running but port 3420 not accessible from browser.

**Cause**: Container lost port mapping after restart.

**Fix**: Always run `docker compose down` before `up` to ensure clean state. Or use `restart.sh`.

**Related**: See `README.md:44-55`

---

## Integration Lessons

### Claude Code PTY Authentication
**Lesson**: Environment variables must be passed correctly from settings.json to PTY.

**Gotcha**: `ANTHROPIC_AUTH_TOKEN` vs `ANTHROPIC_API_KEY` - Claude Code expects both in some versions.

**Code**: See `server.js:246-276` (env var handling)

### Container Path Mapping (CRITICAL)
**Lesson**: Container runs as different user with different paths than host.

**Gotcha**: Code paths inside container are NOT the same as host paths:
- Host `/home/saunalserver` → Container `/home/claude/workspace`
- Host `~/.claude` → Container `/home/claude/.claude`
- Container user is `claude`, not `saunalserver`

**Impact**: If settings.json path is wrong, Claude Code will show login screen on every new session.

**Code**: See `server.js:242-276` (container-aware paths)

**Related**: See `docker-compose.yml:10-13` (volume mounts)

---

## Frontend Lessons

### WebSocket Reconnection
**Lesson**: Implement auto-reconnect on WebSocket disconnect.

**Why**: Server restarts or network hiccups shouldn't require manual page refresh.

**Code**: See `public/app.js:54-57` (2-second reconnect interval)

### Keyboard Shortcut Conflicts
**Lesson**: Prevent browser defaults for Ctrl+T and Ctrl+W.

**Why**: Otherwise browser opens new window or closes tab instead of creating/closing session.

**Code**: See `public/app.js:542-556` (e.preventDefault())

---

## Gotchas

### xterm.js Canvas Rendering
**Gotcha**: xterm.js renders to canvas, making text extraction difficult for tests.

**Workaround**: Use visual screenshots or check for specific DOM elements.

**Related**: See `test-dashboard.js:92-111` (terminal content extraction)

### Memory Leaks
**Risk**: Unbounded growth of upload store or session history.

**Mitigation** (IMPLEMENTED):
- Max uploads limit: 100 files
- Limit history to 100KB per session
- Hourly cleanup interval for expired uploads
- 48-hour TTL on uploaded files

---

## Future Improvements

| Priority | Feature | Why |
|----------|---------|-----|
| Medium | Session rename | Tab shows "term-xyz", should show project name |
| Low | Download session output | Export terminal history to file |
| Low | Dark mode toggle | Current theme is light only |

---

## Related Global Lessons

See `/home/saunalserver/obsidian-vault/nexus/02_MEMORY/GLOBAL_LESSONS.md`:
- **MCP servers**: Use plugin system, NOT global npm install (fork bomb risk)
- **Docker**: Always down before up to prevent port mapping loss
