// ============================================
// Application State
// ============================================
let ws;
let activeSessionId = null;
const sessions = new Map();
const terminals = new Map(); // Store xterm.js Terminal instances per session
const fitAddons = new Map(); // Store FitAddon instances

// DOM Elements
const tabContainer = document.getElementById('tabContainer');
const newTabBtn = document.getElementById('newTabBtn');
const welcomeScreen = document.getElementById('welcomeScreen');
const terminalView = document.getElementById('terminalView');
const terminalContainer = document.getElementById('terminal');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const uploadsList = document.getElementById('uploadsList');

// ============================================
// Debug Logging
// ============================================
function debug(...args) {
  console.log('[ClaudeWebUI]', ...args);
}

// ============================================
// WebSocket Connection
// ============================================
function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  debug('Connecting to', wsUrl);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    debug('Connected');
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      debug('Message received:', message.type);
      handleMessage(message);
    } catch (err) {
      debug('Message parse error:', err);
    }
  };

  ws.onclose = () => {
    debug('Disconnected, reconnecting in 2s...');
    setTimeout(connect, 2000);
  };

  ws.onerror = (error) => {
    debug('WebSocket error:', error);
  };
}

// ============================================
// Message Handler
// ============================================
function handleMessage(message) {
  switch (message.type) {
    case 'init':
      debug('Init with', message.payload.sessions?.length || 0, 'sessions');
      message.payload.sessions?.forEach(session => {
        sessions.set(session.id, session);
        addTab(session);
      });
      if (message.payload.uploads) {
        updateUploadsList(message.payload.uploads);
      }
      break;

    case 'session_created':
      debug('Session created:', message.payload.id);
      sessions.set(message.payload.id, message.payload);
      addTab(message.payload);
      switchToSession(message.payload.id);
      break;

    case 'output':
      handleOutput(message.payload.sessionId, message.payload.data);
      break;

    case 'session_ended':
      debug('Session ended:', message.payload.sessionId);
      markSessionExited(message.payload.sessionId);
      const term = terminals.get(message.payload.sessionId);
      if (term) {
        term.write('\r\n\x1b[31;1mSession ended (exit code: ' + message.payload.exitCode + ')\x1b[0m\r\n');
      }
      break;

    case 'session_closed':
      debug('Session closed:', message.payload.sessionId);
      removeTab(message.payload.sessionId);
      sessions.delete(message.payload.sessionId);
      disposeTerminal(message.payload.sessionId);
      if (activeSessionId === message.payload.sessionId) {
        activeSessionId = null;
        updateTerminalView();
      }
      break;

    case 'attached':
      debug('Attached to session:', message.payload.sessionId);
      break;

    default:
      debug('Unknown message type:', message.type);
  }
}

// ============================================
// Terminal Management with xterm.js
// ============================================
function createTerminal(sessionId) {
  // Check if terminal already exists
  if (terminals.has(sessionId)) {
    return terminals.get(sessionId);
  }

  // Create new xterm.js terminal
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'JetBrains Mono, Monaco, Consolas, monospace',
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#c9d1d9',
      black: '#484f58',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc'
    }
  });

  // Load fit addon
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  fitAddons.set(sessionId, fitAddon);

  // Store terminal
  terminals.set(sessionId, term);

  // Handle user input from terminal
  term.onData((data) => {
    if (activeSessionId === sessionId) {
      sendToServer({
        type: 'send_input',
        payload: {
          sessionId,
          input: data
        }
      });
    }
  });

  // Handle terminal resize
  term.onResize(({ cols, rows }) => {
    if (activeSessionId === sessionId) {
      sendToServer({
        type: 'resize_session',
        payload: {
          sessionId,
          cols,
          rows
        }
      });
    }
  });

  return term;
}

function disposeTerminal(sessionId) {
  const term = terminals.get(sessionId);
  if (term) {
    term.dispose();
    terminals.delete(sessionId);
  }
  const fitAddon = fitAddons.get(sessionId);
  if (fitAddon) {
    fitAddons.delete(sessionId);
  }
}

function handleOutput(sessionId, data) {
  const term = terminals.get(sessionId);
  if (term) {
    term.write(data);
  }
}

// ============================================
// Tab Management
// ============================================
function addTab(session) {
  if (tabContainer.querySelector(`[data-session-id="${session.id}"]`)) {
    return;
  }

  debug('Adding tab for', session.id);

  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.sessionId = session.id;
  tab.innerHTML = `
    <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
    <span class="tab-title">${session.id.slice(-8)}</span>
    <button class="tab-close" title="Close">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;

  // Click to switch
  tab.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-close')) {
      debug('Tab clicked:', session.id);
      switchToSession(session.id);
    }
  });

  // Close button
  const closeBtn = tab.querySelector('.tab-close');
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    debug('Close button clicked:', session.id);
    closeSession(session.id);
  });

  tabContainer.appendChild(tab);
}

function removeTab(sessionId) {
  const tab = tabContainer.querySelector(`[data-session-id="${sessionId}"]`);
  if (tab) {
    tab.remove();
  }
}

function markSessionExited(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.status = 'exited';
  }
  const tab = tabContainer.querySelector(`[data-session-id="${sessionId}"]`);
  if (tab) {
    const icon = tab.querySelector('.tab-icon');
    if (icon) icon.style.opacity = '0.5';
  }
}

function switchToSession(sessionId) {
  debug('Switching to session:', sessionId);
  activeSessionId = sessionId;

  // Update tab active state
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const tab = tabContainer.querySelector(`[data-session-id="${sessionId}"]`);
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

// ============================================
// Terminal View
// ============================================
function updateTerminalView() {
  const session = sessions.get(activeSessionId);

  if (!activeSessionId || !session) {
    welcomeScreen.classList.remove('hidden');
    terminalView.classList.add('hidden');
    return;
  }

  welcomeScreen.classList.add('hidden');
  terminalView.classList.remove('hidden');

  // Get or create terminal for this session
  let term = terminals.get(activeSessionId);
  if (!term) {
    term = createTerminal(activeSessionId);

    // Clear the container and open terminal
    terminalContainer.innerHTML = '';
    term.open(terminalContainer);

    // Fit to container
    const fitAddon = fitAddons.get(activeSessionId);
    if (fitAddon) {
      fitAddon.fit();
    }
  }

  // Focus the terminal
  term.focus();
}

// ============================================
// Server Communication
// ============================================
function sendToServer(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    debug('Cannot send - WebSocket not connected');
  }
}

function createNewSession() {
  debug('Creating new session');
  sendToServer({
    type: 'create_session',
    payload: {
      cwd: '/home/saunalserver'
    }
  });
}

function closeSession(sessionId) {
  sendToServer({
    type: 'close_session',
    payload: { sessionId }
  });
}

// ============================================
// File Upload
// ============================================
async function uploadFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('Please upload an image file');
    return;
  }

  debug('Uploading file:', file.name);

  const formData = new FormData();
  formData.append('screenshot', file);

  try {
    uploadZone.classList.add('uploading');
    uploadZone.querySelector('span').textContent = 'Uploading...';

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error('Upload failed');
    }

    const result = await response.json();

    // Copy URL to clipboard
    await navigator.clipboard.writeText(result.url);
    debug('URL copied to clipboard:', result.url);

    addUploadToList(result);
    loadUploads();

    uploadZone.querySelector('span').textContent = 'Copied to clipboard!';
    setTimeout(() => {
      uploadZone.querySelector('span').textContent = 'Click or drop screenshot';
    }, 2000);

  } catch (error) {
    debug('Upload error:', error);
    uploadZone.querySelector('span').textContent = 'Upload failed';
    setTimeout(() => {
      uploadZone.querySelector('span').textContent = 'Click or drop screenshot';
    }, 2000);
  } finally {
    uploadZone.classList.remove('uploading');
  }
}

async function loadUploads() {
  try {
    const response = await fetch('/api/uploads');
    const uploads = await response.json();
    updateUploadsList(uploads);
  } catch (error) {
    debug('Failed to load uploads:', error);
  }
}

function updateUploadsList(uploads) {
  uploadsList.innerHTML = '';
  uploads.slice(-10).reverse().forEach(upload => {
    addUploadToList(upload);
  });
}

function addUploadToList(upload) {
  if (uploadsList.querySelector(`[data-url="${upload.url}"]`)) {
    return;
  }

  const item = document.createElement('div');
  item.className = 'upload-item';
  item.dataset.url = upload.url;
  item.innerHTML = `
    <img src="${upload.url}" alt="">
    <div class="upload-item-info">
      <div class="upload-item-name">${upload.filename}</div>
      <div class="upload-item-url">${upload.url}</div>
    </div>
    <button class="upload-item-copy" title="Copy URL">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
    </button>
  `;

  item.querySelector('.upload-item-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(upload.url);
    const btn = item.querySelector('.upload-item-copy');
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg>';
    setTimeout(() => {
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    }, 1500);
  });

  item.querySelector('img').addEventListener('click', () => {
    window.open(upload.url, '_blank');
  });

  uploadsList.insertBefore(item, uploadsList.firstChild);

  while (uploadsList.children.length > 10) {
    uploadsList.removeChild(uploadsList.lastChild);
  }
}

// ============================================
// Event Listeners Setup
// ============================================
function setupEventListeners() {
  debug('Setting up event listeners');

  // New tab button
  newTabBtn.addEventListener('click', () => {
    debug('New tab button clicked');
    createNewSession();
  });

  // Sidebar toggle
  sidebarToggle.addEventListener('click', () => {
    debug('Sidebar toggle clicked');
    sidebar.classList.toggle('collapsed');
  });

  // Keyboard shortcuts (prevent browser defaults)
  document.addEventListener('keydown', (e) => {
    // Ctrl+T for new tab - prevent browser default
    if (e.ctrlKey && e.key === 't') {
      e.preventDefault();
      debug('Ctrl+T pressed');
      createNewSession();
    }
    // Ctrl+W to close current tab
    if (e.ctrlKey && e.key === 'w') {
      e.preventDefault();
      if (activeSessionId) {
        closeSession(activeSessionId);
      }
    }
  });

  // File upload - click zone
  uploadZone.addEventListener('click', () => {
    debug('Upload zone clicked');
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      uploadFile(e.target.files[0]);
      fileInput.value = '';
    }
  });

  // Drag and drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  // Sidebar drag and drop
  sidebar.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  sidebar.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  // Handle window resize to fit terminal
  window.addEventListener('resize', () => {
    if (activeSessionId) {
      const fitAddon = fitAddons.get(activeSessionId);
      if (fitAddon) {
        fitAddon.fit();
      }
    }
  });

  debug('Event listeners setup complete');
}

// ============================================
// Initialize
// ============================================
function init() {
  debug('Initializing application');
  setupEventListeners();
  connect();
  loadUploads();
  debug('Initialization complete');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
