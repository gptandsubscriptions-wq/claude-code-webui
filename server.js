import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import pty from 'node-pty';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3420;

// Store active PTY sessions
const sessions = new Map();
// Store WebSocket connections per session
const connections = new Map();

// ============================================
// In-Memory Upload Store (48-hour TTL)
// ============================================
// Use relative URLs by default, or override with PUBLIC_URL env var
const UPLOAD_URL_BASE = process.env.PUBLIC_URL || '';  // Empty = use relative URLs
const UPLOAD_TTL = 48 * 60 * 60 * 1000; // 48 hours in milliseconds
const MAX_UPLOADS = 100; // Prevent memory exhaustion

// In-memory upload store: { id: { buffer, mimetype, originalname, size, uploadedAt, expiresAt } }
const uploadStore = new Map();

// Cleanup expired uploads (run hourly)
function cleanupExpiredUploads() {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, upload] of uploadStore.entries()) {
    if (upload.expiresAt < now) {
      uploadStore.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[Cleanup] Removed ${cleaned} expired upload(s) (store size: ${uploadStore.size})`);
  }
}
setInterval(cleanupExpiredUploads, 60 * 60 * 1000); // Run every hour

// Configure multer for in-memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname || mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// API Routes
// ============================================

// Health check
app.get('/health', (req, res) => {
  const sessionList = Array.from(sessions.values()).map(s => ({
    id: s.id,
    cwd: s.cwd,
    status: s.status
  }));
  res.json({
    sessions: sessionList,
    total: sessions.size,
    uploads: uploadStore.size
  });
});

// Get active sessions list
app.get('/api/sessions', (req, res) => {
  const sessionList = Array.from(sessions.values()).map(s => ({
    id: s.id,
    cwd: s.cwd,
    status: s.status,
    createdAt: s.createdAt
  }));
  res.json(sessionList);
});

// Upload screenshot endpoint (in-memory)
app.post('/api/upload', upload.single('screenshot'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Enforce max uploads limit
  if (uploadStore.size >= MAX_UPLOADS) {
    cleanupExpiredUploads(); // Try to free up space
    if (uploadStore.size >= MAX_UPLOADS) {
      return res.status(503).json({ error: 'Upload store full, try again later' });
    }
  }

  const uploadId = uuidv4();
  const expiresAt = Date.now() + UPLOAD_TTL;

  // Store in memory
  uploadStore.set(uploadId, {
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
    originalname: req.file.originalname,
    size: req.file.size,
    uploadedAt: Date.now(),
    expiresAt
  });

  // Generate URL: use request's protocol+host if no PUBLIC_URL set, otherwise use PUBLIC_URL
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = UPLOAD_URL_BASE || `${protocol}://${host}`;
  const fileUrl = `${baseUrl}/uploads/${uploadId}`;

  console.log(`[Upload] Stored ${req.file.originalname} (${Math.round(req.file.size / 1024)}KB) until ${new Date(expiresAt).toISOString()}`);

  res.json({
    url: fileUrl,
    id: uploadId,
    filename: req.file.originalname,
    size: req.file.size,
    expiresAt: new Date(expiresAt).toISOString()
  });
});

// Serve uploaded image from memory
app.get('/uploads/:id', (req, res) => {
  const upload = uploadStore.get(req.params.id);

  if (!upload) {
    return res.status(404).json({ error: 'Upload not found or expired' });
  }

  res.set('Content-Type', upload.mimetype);
  res.set('Cache-Control', 'private, max-age=172800'); // 48 hours
  res.send(upload.buffer);
});

// List uploaded files
app.get('/api/uploads', (req, res) => {
  const uploads = [];
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = UPLOAD_URL_BASE || `${protocol}://${host}`;

  for (const [id, upload] of uploadStore.entries()) {
    uploads.push({
      id,
      filename: upload.originalname,
      url: `${baseUrl}/uploads/${id}`,
      size: upload.size,
      expiresAt: new Date(upload.expiresAt).toISOString()
    });
  }
  res.json(uploads);
});

// ============================================
// Server & WebSocket
// ============================================

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Code WebUI running on http://0.0.0.0:${PORT}`);
  console.log(`Access via Tailscale: http://100.96.197.39:${PORT}`);
  console.log(`Workspace: /home/saunalserver`);
  console.log(`Upload TTL: 48 hours (in-memory storage)`);
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  console.log(`Client connected: ${clientId}`);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`[${clientId}] ${data.type}:`, data.payload || '');

      switch (data.type) {
        case 'create_session':
          await createSession(ws, data.payload);
          break;
        case 'send_input':
          sendInput(data.payload.sessionId, data.payload.input);
          break;
        case 'close_session':
          closeSession(data.payload.sessionId);
          break;
        case 'attach_session':
          attachSession(ws, data.payload.sessionId);
          break;
        case 'resize_session':
          resizeSession(data.payload.sessionId, data.payload.cols, data.payload.rows);
          break;
      }
    } catch (err) {
      console.error(`Error handling message:`, err);
    }
  });

  ws.on('close', () => {
    // Remove this client from all session connections
    for (const [sessionId, clientSet] of connections.entries()) {
      clientSet.delete(ws);
    }
    console.log(`Client disconnected: ${clientId}`);
  });

  // Get the base URL from the request (works for both Tailscale and LAN access)
  // Note: WebSocket req is plain HTTP request, not Express request
  const protocol = (req.headers['x-forwarded-proto'] || 'http').replace('https', 'http'); // ws uses http
  const host = req.headers.host || `localhost:${PORT}`;
  const baseUrl = UPLOAD_URL_BASE || `${protocol}://${host}`;

  // Send initial state
  ws.send(JSON.stringify({
    type: 'init',
    payload: {
      sessions: Array.from(sessions.values()).map(s => ({
        id: s.id,
        cwd: s.cwd,
        status: s.status,
        createdAt: s.createdAt
      })),
      uploads: Array.from(uploadStore.entries()).map(([id, upload]) => ({
        id,
        filename: upload.originalname,
        url: `${baseUrl}/uploads/${id}`
      }))
    }
  }));
});

// ============================================
// Session Management
// ============================================

function createSession(ws, payload) {
  const sessionId = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  // Inside container, workspace is at /home/claude/workspace (maps to host's /home/saunalserver)
  const cwd = payload?.cwd || '/home/claude/workspace';

  console.log(`Creating PTY session ${sessionId} in ${cwd}`);

  // Read settings to pass all env vars to claude
  let envVars = {};
  try {
    // Inside container, settings are at /home/claude/.claude/settings.json (mounted from host's ~/.claude)
    const settingsPath = path.join('/home/claude', '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      envVars = { ...settings.env };
      // Avoid auth conflict: only use ANTHROPIC_AUTH_TOKEN, clear ANTHROPIC_API_KEY if it's a duplicate
      if (envVars.ANTHROPIC_AUTH_TOKEN && envVars.ANTHROPIC_API_KEY === envVars.ANTHROPIC_AUTH_TOKEN) {
        delete envVars.ANTHROPIC_API_KEY;
      }
      console.log('Loaded settings from /home/claude/.claude/settings.json');
    }
  } catch (e) {
    console.log('Could not read settings:', e.message);
  }

  // Debug: log the auth token being used
  console.log('Auth token (first 20 chars):', envVars.ANTHROPIC_AUTH_TOKEN?.slice(0, 20) || 'none');
  console.log('API key (first 20 chars):', envVars.ANTHROPIC_API_KEY?.slice(0, 20) || 'none');
  console.log('Base URL:', envVars.ANTHROPIC_BASE_URL || 'default');
  console.log('Z_AI_API_KEY (first 20 chars):', envVars.Z_AI_API_KEY?.slice(0, 20) || 'none');

  // Create the full environment with correct HOME (inside container)
  const ptyEnv = {
    ...process.env,
    HOME: '/home/claude',
    USER: 'claude',
    ...envVars
  };

  // Debug: log key env vars that will be passed to PTY
  console.log('PTY will have HOME:', ptyEnv.HOME);
  console.log('PTY will have ANTHROPIC_AUTH_TOKEN:', ptyEnv.ANTHROPIC_AUTH_TOKEN?.slice(0, 20) + '...' || 'none');
  console.log('PTY will have ANTHROPIC_API_KEY:', ptyEnv.ANTHROPIC_API_KEY?.slice(0, 20) + '...' || 'none');
  console.log('PTY will have ANTHROPIC_BASE_URL:', ptyEnv.ANTHROPIC_BASE_URL || 'none');
  console.log('PTY will have Z_AI_API_KEY:', ptyEnv.Z_AI_API_KEY?.slice(0, 20) + '...' || 'none');

  // Create a PTY - run claude with all settings from environment
  const ptyProcess = pty.spawn('claude', ['--dangerously-skip-permissions'], {
    name: 'xterm-color',
    cwd: cwd,
    env: ptyEnv,
    cols: 80,
    rows: 24
  });

  const session = {
    id: sessionId,
    cwd: cwd,
    status: 'running',
    createdAt: new Date().toISOString(),
    pty: ptyProcess,
    history: [],  // Stores terminal output for reconnect persistence
    historySize: 0,  // Track total size to limit memory usage
    setupHandled: false  // Track if we've auto-selected the theme
  };

  sessions.set(sessionId, session);

  // Track connections to this session
  if (!connections.has(sessionId)) {
    connections.set(sessionId, new Set());
  }
  connections.get(sessionId).add(ws);

  // Send "1" + Enter immediately to auto-select theme and bypass setup screen
  // This must be done before any output processing
  setTimeout(() => {
    if (session.pty && !session.setupHandled) {
      ptyProcess.write('1\r');
      session.setupHandled = true;
      console.log(`Auto-selected theme for session ${sessionId}`);
    }
  }, 1000);  // 1 second delay for Claude Code to start

  // Buffer to detect theme setup screen (backup method)
  let outputBuffer = '';

  // Forward PTY output to all connected clients and store in history
  ptyProcess.onData((data) => {
    // Store in history (limit to ~100KB to prevent memory issues)
    const MAX_HISTORY_SIZE = 100 * 1024;
    if (session.historySize + data.length < MAX_HISTORY_SIZE) {
      session.history.push(data);
      session.historySize += data.length;
    }

    // Auto-select theme on first-run setup screen
    if (!session.setupHandled) {
      outputBuffer += data;
      // Check for theme setup screen (case-insensitive)
      if (outputBuffer.toLowerCase().includes('let\'s get started') ||
          outputBuffer.toLowerCase().includes('choose the text style')) {
        // Send "1" + Enter to select first option (Dark mode)
        setTimeout(() => {
          ptyProcess.write('1\r');
          session.setupHandled = true;
          console.log(`Auto-selected theme for session ${sessionId}`);
        }, 500);  // Small delay to ensure screen is fully rendered
      }
      // Keep buffer manageable
      if (outputBuffer.length > 1000) {
        outputBuffer = outputBuffer.slice(-500);
      }
    }

    broadcastToSession(sessionId, {
      type: 'output',
      payload: {
        sessionId,
        data: data
      }
    });
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`PTY session ${sessionId} exited with code ${exitCode}`);
    session.status = 'exited';
    session.pty = null;

    // Send session_ended event first
    broadcastToSession(sessionId, {
      type: 'session_ended',
      payload: {
        sessionId,
        exitCode: exitCode || 0,
        signal: signal || 'UNKNOWN'
      }
    });

    // Then do full cleanup (same as closeSession)
    broadcastToSession(sessionId, {
      type: 'session_closed',
      payload: { sessionId }
    });

    // Clean up connections for this session
    connections.delete(sessionId);

    // Finally delete the session
    sessions.delete(sessionId);
  });

  // Send session created response
  ws.send(JSON.stringify({
    type: 'session_created',
    payload: {
      id: sessionId,
      cwd: cwd,
      status: 'running',
      createdAt: session.createdAt
    }
  }));
}

function sendInput(sessionId, input) {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'running' || !session.pty) {
    return;
  }

  // Send input directly to PTY - xterm.js sends raw key data including Enter (\r)
  session.pty.write(input);
}

function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    // Session already closed or doesn't exist, clean up connections anyway
    connections.delete(sessionId);
    return;
  }

  console.log(`Closing session ${sessionId}`);

  if (session.pty && session.status === 'running') {
    // Send /exit for graceful shutdown
    session.pty.write('/exit\r');

    // Set a timeout to force kill if it doesn't exit gracefully
    setTimeout(() => {
      const s = sessions.get(sessionId);
      if (s && s.pty && s.status === 'running') {
        console.log(`Session ${sessionId} didn't exit gracefully, forcing kill`);
        s.pty.kill();
      }
    }, 3000);  // 3 second timeout
  } else {
    // No PTY or already exited, clean up immediately
    session.status = 'closed';

    // Broadcast BEFORE deleting so clients can handle the close
    broadcastToSession(sessionId, {
      type: 'session_closed',
      payload: { sessionId }
    });

    // Clean up connections for this session
    connections.delete(sessionId);

    // Finally delete the session
    sessions.delete(sessionId);
  }
}

function attachSession(ws, sessionId) {
  if (!connections.has(sessionId)) {
    connections.set(sessionId, new Set());
  }
  connections.get(sessionId).add(ws);

  const session = sessions.get(sessionId);

  ws.send(JSON.stringify({
    type: 'attached',
    payload: {
      sessionId,
      // Send history buffer for session persistence
      history: session?.history || []
    }
  }));
}

function resizeSession(sessionId, cols, rows) {
  const session = sessions.get(sessionId);
  if (session && session.pty && session.status === 'running') {
    session.pty.resize(cols, rows);
  }
}

function broadcastToSession(sessionId, message) {
  const clients = connections.get(sessionId);
  if (!clients) return;

  const messageStr = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing sessions...');

  // Kill all PTY sessions
  sessions.forEach((session, id) => {
    if (session.pty) {
      session.pty.kill();
    }
  });

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
