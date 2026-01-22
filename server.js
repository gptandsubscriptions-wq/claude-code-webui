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

// Temporary uploads storage
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const UPLOAD_URL_BASE = process.env.PUBLIC_URL || `http://100.96.197.39:${PORT}`;

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const uniqueName = `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
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

// Serve uploaded files
app.use('/uploads', express.static(UPLOAD_DIR));

// Health check
app.get('/health', (req, res) => {
  const sessionList = Array.from(sessions.values()).map(s => ({
    id: s.id,
    cwd: s.cwd,
    status: s.status
  }));
  res.json({ sessions: sessionList, total: sessions.size });
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

// Upload screenshot endpoint
app.post('/api/upload', upload.single('screenshot'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileUrl = `${UPLOAD_URL_BASE}/uploads/${req.file.filename}`;

  // Schedule cleanup after 1 hour
  setTimeout(() => {
    const filePath = path.join(UPLOAD_DIR, req.file.filename);
    fs.unlink(filePath, (err) => {
      if (err) console.error(`Failed to delete ${req.file.filename}:`, err);
    });
  }, 60 * 60 * 1000);

  res.json({
    url: fileUrl,
    filename: req.file.filename,
    size: req.file.size,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
});

// List uploaded files
app.get('/api/uploads', (req, res) => {
  const files = fs.readdirSync(UPLOAD_DIR).map(filename => {
    const filePath = path.join(UPLOAD_DIR, filename);
    const stats = fs.statSync(filePath);
    return {
      filename,
      url: `${UPLOAD_URL_BASE}/uploads/${filename}`,
      size: stats.size,
      created: stats.mtime
    };
  });
  res.json(files);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Code WebUI running on http://0.0.0.0:${PORT}`);
  console.log(`Access via Tailscale: http://100.96.197.39:${PORT}`);
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
      uploads: fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).map(filename => ({
        filename,
        url: `${UPLOAD_URL_BASE}/uploads/${filename}`
      })) : []
    }
  }));
});

function createSession(ws, payload) {
  const sessionId = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const cwd = payload?.cwd || process.env.HOME || '/home/saunalserver';

  console.log(`Creating PTY session ${sessionId} in ${cwd}`);

  // Create a PTY - run claude in interactive mode
  const ptyProcess = pty.spawn('claude', ['--dangerously-skip-permissions'], {
    name: 'xterm-color',
    cwd: cwd,
    env: process.env,
    cols: 80,
    rows: 24
  });

  const session = {
    id: sessionId,
    cwd: cwd,
    status: 'running',
    createdAt: new Date().toISOString(),
    pty: ptyProcess,
    history: []
  };

  sessions.set(sessionId, session);

  // Track connections to this session
  if (!connections.has(sessionId)) {
    connections.set(sessionId, new Set());
  }
  connections.get(sessionId).add(ws);

  // Forward PTY output to all connected clients
  ptyProcess.onData((data) => {
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

    broadcastToSession(sessionId, {
      type: 'session_ended',
      payload: {
        sessionId,
        exitCode: exitCode || 0,
        signal: signal || 'UNKNOWN'
      }
    });
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
  if (!session) return;

  console.log(`Closing session ${sessionId}`);

  if (session.pty) {
    session.pty.kill();
  }

  session.status = 'closed';
  sessions.delete(sessionId);

  broadcastToSession(sessionId, {
    type: 'session_closed',
    payload: { sessionId }
  });
}

function attachSession(ws, sessionId) {
  if (!connections.has(sessionId)) {
    connections.set(sessionId, new Set());
  }
  connections.get(sessionId).add(ws);

  ws.send(JSON.stringify({
    type: 'attached',
    payload: { sessionId }
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
