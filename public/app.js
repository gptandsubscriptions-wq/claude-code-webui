// WebSocket connection
let ws;
let activeSessionId = null;
const sessions = new Map();

// DOM Elements
const terminalTabs = document.getElementById('terminalTabs');
const terminalView = document.getElementById('terminalView');
const terminalOutput = document.getElementById('terminalOutput');
const terminalInput = document.getElementById('terminalInput');
const inputArea = document.getElementById('inputArea');
const emptyState = document.getElementById('emptyState');
const newTerminalBtn = document.getElementById('newTerminalBtn');
const closeBtn = document.getElementById('closeBtn');
const clearBtn = document.getElementById('clearBtn');
const terminalId = document.getElementById('terminalId');
const terminalCwd = document.getElementById('terminalCwd');
const welcomeCwd = document.getElementById('welcomeCwd');

// Initialize
function init() {
  connect();
  setupEventListeners();
  updateCwd();
}

function updateCwd() {
  fetch('/health')
    .then(r => r.json())
    .then(data => {
      // Could show current working directory here
    })
    .catch(console.error);
}

// WebSocket connection
function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Connected to server');
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleMessage(message);
  };

  ws.onclose = () => {
    console.log('Disconnected from server');
    // Reconnect after 2 seconds
    setTimeout(connect, 2000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

// Handle incoming messages
function handleMessage(message) {
  switch (message.type) {
    case 'init':
      message.payload.sessions.forEach(session => {
        sessions.set(session.id, session);
        addTerminalTab(session);
      });
      break;

    case 'session_created':
      sessions.set(message.payload.id, message.payload);
      addTerminalTab(message.payload);
      switchToSession(message.payload.id);
      break;

    case 'output':
      if (message.payload.sessionId === activeSessionId) {
        appendOutput(message.payload.data);
      }
      break;

    case 'error':
      if (message.payload.sessionId === activeSessionId) {
        appendError(message.payload.data);
      }
      break;

    case 'session_ended':
      const session = sessions.get(message.payload.sessionId);
      if (session) {
        session.status = 'exited';
        updateTabStatus(message.payload.sessionId, 'exited');
      }
      appendSystemMessage(`Session ended with exit code ${message.payload.exitCode}`);
      break;

    case 'session_closed':
      removeTerminalTab(message.payload.sessionId);
      sessions.delete(message.payload.sessionId);
      if (activeSessionId === message.payload.sessionId) {
        activeSessionId = null;
        updateTerminalView();
      }
      break;

    case 'attached':
      // Successfully attached to session
      break;
  }
}

// Setup event listeners
function setupEventListeners() {
  newTerminalBtn.addEventListener('click', createNewSession);

  closeBtn.addEventListener('click', () => {
    if (activeSessionId) {
      sendToServer({
        type: 'close_session',
        payload: { sessionId: activeSessionId }
      });
    }
  });

  clearBtn.addEventListener('click', () => {
    terminalOutput.innerHTML = '';
  });

  terminalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const input = terminalInput.value.trim();
      if (input && activeSessionId) {
        // Echo user input
        appendUserInput(input);

        // Send to server
        sendToServer({
          type: 'send_input',
          payload: {
            sessionId: activeSessionId,
            input: input
          }
        });

        terminalInput.value = '';
      }
    }
  });

  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      // Could add page switching logic here
    });
  });
}

// Send message to server
function sendToServer(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Create new session
function createNewSession() {
  sendToServer({
    type: 'create_session',
    payload: {
      cwd: '/home/saunalserver'
    }
  });
}

// Add terminal tab
function addTerminalTab(session) {
  const tab = document.createElement('div');
  tab.className = 'terminal-tab';
  tab.dataset.sessionId = session.id;
  tab.innerHTML = `
    <span class="status-dot ${session.status === 'running' ? 'active' : ''}"></span>
    <span class="tab-id">${session.id}</span>
    <button class="close-tab" title="Close session">×</button>
  `;

  // Click to switch
  tab.addEventListener('click', (e) => {
    if (!e.target.classList.contains('close-tab')) {
      switchToSession(session.id);
    }
  });

  // Close button
  tab.querySelector('.close-tab').addEventListener('click', (e) => {
    e.stopPropagation();
    sendToServer({
      type: 'close_session',
      payload: { sessionId: session.id }
    });
  });

  terminalTabs.appendChild(tab);
}

// Remove terminal tab
function removeTerminalTab(sessionId) {
  const tab = terminalTabs.querySelector(`[data-session-id="${sessionId}"]`);
  if (tab) {
    tab.remove();
  }
}

// Update tab status
function updateTabStatus(sessionId, status) {
  const tab = terminalTabs.querySelector(`[data-session-id="${sessionId}"]`);
  if (tab) {
    const dot = tab.querySelector('.status-dot');
    if (status === 'exited') {
      dot.style.background = 'var(--text-muted)';
      dot.classList.remove('active');
    }
  }
}

// Switch to session
function switchToSession(sessionId) {
  activeSessionId = sessionId;

  // Update tab active state
  document.querySelectorAll('.terminal-tab').forEach(t => t.classList.remove('active'));
  const tab = terminalTabs.querySelector(`[data-session-id="${sessionId}"]`);
  if (tab) {
    tab.classList.add('active');
  }

  // Attach to session
  sendToServer({
    type: 'attach_session',
    payload: { sessionId }
  });

  updateTerminalView();
}

// Update terminal view
function updateTerminalView() {
  const session = sessions.get(activeSessionId);

  if (!session) {
    terminalView.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  terminalView.classList.remove('hidden');
  emptyState.classList.add('hidden');

  // Update header
  terminalId.textContent = session.id;
  terminalCwd.textContent = session.cwd;

  // Only show welcome screen if no output AND output area is empty
  const hasExistingOutput = terminalOutput.querySelector('.output-line');
  if (!session.hasOutput && !hasExistingOutput) {
    terminalOutput.innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-box">
          <div class="welcome-header">
            <h2>Claude Code v2.1.6</h2>
          </div>
          <div class="welcome-content">
            <div class="welcome-left">
              <div class="welcome-greeting">
                <svg class="robot-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="11" width="18" height="10" rx="2"/>
                  <circle cx="12" cy="5" r="2"/>
                  <path d="M12 7v4"/>
                  <line x1="8" y1="16" x2="8" y2="16"/>
                  <line x1="16" y1="16" x2="16" y2="16"/>
                </svg>
                <h3>Welcome back!</h3>
              </div>
              <p class="model-info">Sonnet 4.5 · API Usage Billing</p>
              <p class="cwd-info">${session.cwd}</p>
            </div>
            <div class="welcome-right">
              <h4>Tips for getting started</h4>
              <ul class="tips-list">
                <li>Each terminal is a fresh <code>claude --dangerously-skip-permissions</code> session</li>
                <li>Click <strong>+ New Terminal</strong> to start a new session</li>
                <li>Sessions persist even if you close the browser tab</li>
              </ul>
            </div>
          </div>
          <div class="welcome-footer">
            <span class="activity-label">Session ID</span>
            <span class="activity-status">${session.id}</span>
          </div>
        </div>
      </div>
    `;
  }

  // Show input area
  inputArea.style.display = 'block';
  terminalInput.focus();
}

// Strip ANSI escape codes (improved)
function stripAnsiCodes(text) {
  // Remove ALL ANSI escape sequences including:
  // - CSI sequences: ESC [ ...
  // - Private mode sequences: ESC [ ? ...
  // - Cursor sequences: ESC [ A/B/C/D/E/F/G/H/J/K/M/P
  // - Device control strings
  const ansiRegex = /\x1b\[[?0-9;]*[A-Za-z~]|\x1b\][0-9;]*\x07|\x1b[\(\)][A-B0-1]/g;
  return text.replace(ansiRegex, '');
}

// Append output
function appendOutput(data) {
  const session = sessions.get(activeSessionId);
  if (session) {
    session.hasOutput = true;
  }

  // Clear welcome screen if present
  const welcomeScreen = terminalOutput.querySelector('.welcome-screen');
  if (welcomeScreen) {
    welcomeScreen.remove();
  }

  // Strip ANSI codes and split by newlines
  const cleanText = stripAnsiCodes(data);
  const lines = cleanText.split('\n');

  lines.forEach((lineText, index) => {
    // Skip empty lines at the end
    if (index === lines.length - 1 && !lineText) return;

    const line = document.createElement('div');
    line.className = 'output-line';
    line.textContent = lineText;
    terminalOutput.appendChild(line);
  });

  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// Append user input
function appendUserInput(input) {
  const line = document.createElement('div');
  line.className = 'output-line user-input';
  line.textContent = `$ ${input}`;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// Append error
function appendError(data) {
  const line = document.createElement('div');
  line.className = 'output-line error';
  line.textContent = data;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// Append system message
function appendSystemMessage(message) {
  const line = document.createElement('div');
  line.className = 'output-line system';
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// Start
init();
