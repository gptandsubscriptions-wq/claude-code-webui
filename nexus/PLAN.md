# Claude Code WebUI - Implementation Plan

> Enhancement sprint for existing project (2026-01-22)

---

## Overview

**Goal**: Refine screenshot storage from disk-based to in-memory with 48-hour TTL.

**Scope**: Minimal changes to server.js only. Frontend and architecture are solid.

**Complexity**: Low - straightforward refactoring of existing upload mechanism.

---

## Phase 1: In-Memory Storage Migration

### Task 1.1: Convert multer to memory storage
**File**: `server.js:31-40`

**Current**:
```javascript
const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, UPLOAD_DIR); },
  filename: (req, file, cb) => { /* generate filename */ }
});
```

**Change to**:
```javascript
// Remove UPLOAD_DIR, use memory storage
const storage = multer.memoryStorage();
```

**Acceptance**: Uploads stored in memory, no files written to disk.

---

### Task 1.2: Implement in-memory upload store
**File**: `server.js` (new section after line 55)

**Add**:
```javascript
// In-memory upload store: { id: { buffer, mimetype, filename, expiresAt } }
const uploadStore = new Map();
const UPLOAD_TTL = 48 * 60 * 60 * 1000; // 48 hours in ms

// Cleanup expired uploads
function cleanupExpiredUploads() {
  const now = Date.now();
  for (const [id, upload] of uploadStore.entries()) {
    if (upload.expiresAt < now) {
      uploadStore.delete(id);
    }
  }
}
setInterval(cleanupExpiredUploads, 60 * 60 * 1000); // Run hourly
```

**Acceptance**: Uploads stored in Map, hourly cleanup scheduled.

---

### Task 1.3: Update upload endpoint
**File**: `server.js:84-106`

**Changes**:
1. Generate unique ID (UUID)
2. Store in memory instead of writing to disk
3. Set expiration timestamp
4. Return URL with ID instead of filename

**Implementation**:
```javascript
app.post('/api/upload', upload.single('screenshot'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const uploadId = uuidv4();
  const expiresAt = Date.now() + UPLOAD_TTL;

  uploadStore.set(uploadId, {
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
    originalname: req.file.originalname,
    size: req.file.size,
    uploadedAt: Date.now(),
    expiresAt
  });

  const fileUrl = `${UPLOAD_URL_BASE}/uploads/${uploadId}`;

  res.json({
    url: fileUrl,
    id: uploadId,
    size: req.file.size,
    expiresAt: new Date(expiresAt).toISOString()
  });
});
```

**Acceptance**: Upload returns URL with UUID, stores buffer in memory.

---

### Task 1.4: Update serve route
**File**: `server.js` (new route)

**Add**:
```javascript
app.get('/uploads/:id', (req, res) => {
  const upload = uploadStore.get(req.params.id);

  if (!upload) {
    return res.status(404).json({ error: 'Upload not found or expired' });
  }

  res.set('Content-Type', upload.mimetype);
  res.set('Cache-Control', 'private, max-age=172800'); // 48 hours
  res.send(upload.buffer);
});
```

**Acceptance**: Serves images from memory, 404s for expired/missing uploads.

---

### Task 1.5: Update uploads list endpoint
**File**: `server.js:109-121`

**Change to**:
```javascript
app.get('/api/uploads', (req, res) => {
  const uploads = [];
  for (const [id, upload] of uploadStore.entries()) {
    uploads.push({
      id,
      filename: upload.originalname,
      url: `${UPLOAD_URL_BASE}/uploads/${id}`,
      size: upload.size,
      expiresAt: new Date(upload.expiresAt).toISOString()
    });
  }
  res.json(uploads);
});
```

**Acceptance**: Lists uploads from memory store with correct URLs.

---

### Task 1.6: Remove disk-based code
**File**: `server.js`

**Remove**:
- `UPLOAD_DIR` variable and `fs.existsSync` check (lines 22-28)
- Any references to filesystem operations for uploads

**Acceptance**: No filesystem writes for uploads.

---

## Phase 2: Workspace Path Fix

### Task 2.1: Update default workspace
**File**: `server.js:191`

**Change**:
```javascript
const cwd = payload?.cwd || '/home/saunalserver';
```

**Acceptance**: New sessions use `/home/saunalserver` as default directory.

---

## Phase 3: Testing

### Task 3.1: Manual testing checklist
- [ ] Upload screenshot → URL returned
- [ ] Paste URL in Claude → Image visible
- [ ] Check uploads list → Image appears
- [ ] Wait > 48h → Image expires (can test with shorter TTL)
- [ ] Page refresh → Tabs and content persist
- [ ] Create new session → Uses `/home/saunalserver`
- [ ] Memory cleanup → No leaks

---

## Implementation Order

1. **Start with**: Task 1.2 (add uploadStore) - foundation
2. **Then**: Task 1.1 + 1.3 (upload endpoint) - core functionality
3. **Then**: Task 1.4 (serve route) - make URLs work
4. **Then**: Task 1.5 + 1.6 (list + cleanup) - complete API
5. **Finally**: Task 2.1 (workspace path) - quality fix
6. **Test**: Task 3.1 (manual testing)

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Memory leak from unbounded uploads | High | Enforce max uploads limit, TTL cleanup |
| Lost uploads on server restart | Accepted | In-memory by design, restart clears all |
| Browser caches old URLs | Low | Cache-Control header, 404 handling |

---

## Success Criteria

1. Uploads stored only in memory (no disk writes)
2. 48-hour TTL enforced with automatic cleanup
3. Workspace defaults to `/home/saunalserver`
4. Existing functionality unchanged (tabs, persistence, streaming)

---

## Estimation

| Phase | Tasks | Complexity |
|-------|-------|------------|
| Phase 1 | 1.1 - 1.6 | Simple |
| Phase 2 | 2.1 | Trivial |
| Phase 3 | 3.1 | Simple |

**Total**: 1-2 hours implementation + testing
