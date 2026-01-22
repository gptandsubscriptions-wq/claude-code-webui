import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3420;

// Store active sessions
const sessions = new Map();
// Store WebSocket connections per session
const connections = new Map();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

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
          await sendInput(data.payload.sessionId, data.payload.input);
          break;
        case 'close_session':
          closeSession(data.payload.sessionId);
          break;
        case 'attach_session':
          attachSession(ws, data.payload.sessionId);
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
      }))
    }
  }));
});

function createSession(ws, payload) {
  const sessionId = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const cwd = payload?.cwd || process.env.HOME || '/home/saunalserver';

  console.log(`Creating session ${sessionId} in ${cwd}`);

  const session = {
    id: sessionId,
    cwd: cwd,
    status: 'running',
    createdAt: new Date().toISOString(),
    history: []
  };

  sessions.set(sessionId, session);

  // Track connections to this session
  if (!connections.has(sessionId)) {
    connections.set(sessionId, new Set());
  }
  connections.get(sessionId).add(ws);

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

  // Send welcome message
  broadcastToSession(sessionId, {
    type: 'output',
    payload: {
      sessionId,
      data: `╭─── Claude Code v2.0.76 ──────────────────────────────────────────────────────╮
│                    Welcome back!                    │
│                                                            │
│ Using --print mode: Each message spawns a fresh Claude instance  │
│                                                            │
╰──────────────────────────────────────────────────────────────────────────────╯

`
    }
  });
}

async function sendInput(sessionId, input) {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'running') {
    return;
  }

  // Echo user input
  broadcastToSession(sessionId, {
    type: 'output',
    payload: {
      sessionId,
      data: `\n> ${input}\n`
    }
  });

  // Spawn claude with --print mode
  // Input is passed via stdin, not as argument
  const claudeProcess = spawn('claude', [
    '--permission-mode',
    'bypassPermissions',
    '--print'
  ], {
    cwd: session.cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Write input to stdin
  claudeProcess.stdin.write(input);
  claudeProcess.stdin.end();

  let stdout = '';
  let stderr = '';

  claudeProcess.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  claudeProcess.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  claudeProcess.on('close', (code) => {
    console.log(`Claude process exited with code ${code}, stdout length: ${stdout.length}, stderr length: ${stderr.length}`);

    if (stderr) {
      console.log(`STDERR: ${stderr}`);
      broadcastToSession(sessionId, {
        type: 'error',
        payload: {
          sessionId,
          data: stderr
        }
      });
    }

    if (stdout) {
      console.log(`STDOUT: ${stdout.substring(0, 200)}...`);
      broadcastToSession(sessionId, {
        type: 'output',
        payload: {
          sessionId,
          data: stdout + '\n'
        }
      });
    }

    // Show prompt again
    broadcastToSession(sessionId, {
      type: 'output',
      payload: {
        sessionId,
        data: '\n────────────────────────────────────────────────────────────────────────────────\n'
      }
    });
  });
}

function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  console.log(`Closing session ${sessionId}`);
  session.status = 'closed';

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
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
