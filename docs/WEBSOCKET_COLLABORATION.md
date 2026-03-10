# WebSocket Collaboration System

## Overview

The Giga-PDF WebSocket collaboration system enables real-time multi-user editing of PDF documents. Users can see each other's cursors, lock elements for editing, and receive live updates when other users make changes.

## Architecture

### Components

1. **CollaborationManager** (`app/services/collaboration_service.py`)
   - Manages collaboration sessions in the database
   - Handles element locking with automatic expiration
   - Assigns unique colors to users
   - Tracks active users per document

2. **WebSocket Server** (`app/api/websocket.py`)
   - Socket.IO server for real-time communication
   - Event handlers for collaboration actions
   - Room-based messaging (one room per document)
   - Redis-backed message queue for multi-worker support

3. **Database Models** (`app/models/database.py`)
   - `CollaborationSession`: Tracks active users and their state
   - `ElementLock`: Prevents concurrent edits to the same element

## Connection

### Endpoint

```
ws://your-domain/ws/socket.io
```

### Authentication

WebSocket connections require JWT authentication. Pass the token in the `auth` parameter when connecting:

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:8000/ws', {
  auth: {
    token: 'your-jwt-token-here'
  }
});
```

```python
import socketio

sio = socketio.AsyncClient()

await sio.connect(
    'http://localhost:8000/ws',
    auth={'token': 'your-jwt-token-here'}
)
```

```php
<?php
use SocketIO\Client;

$socket = new Client('http://localhost:8000/ws', [
    'auth' => [
        'token' => 'your-jwt-token-here'
    ]
]);
```

```bash
# Using curl to test connection (limited WebSocket support)
curl -N \
  -H "Authorization: Bearer your-jwt-token" \
  http://localhost:8000/ws/socket.io/?transport=polling
```

## Events

### Client → Server

#### join_document

Join a document collaboration room.

**Request:**
```javascript
socket.emit('join_document', {
  document_id: 'doc-uuid-here'
}, (response) => {
  console.log(response);
});
```

```python
response = await sio.emit('join_document', {
    'document_id': 'doc-uuid-here'
})
```

```php
$socket->emit('join_document', [
    'document_id' => 'doc-uuid-here'
], function($response) {
    print_r($response);
});
```

```bash
# Emitting events via curl (using Socket.IO polling transport)
curl -X POST http://localhost:8000/ws/socket.io/ \
  -H "Content-Type: application/json" \
  -d '{"event":"join_document","data":{"document_id":"doc-uuid"}}'
```

**Response:**
```json
{
  "success": true,
  "session": {
    "session_id": "session-uuid",
    "user_color": "#3B82F6"
  },
  "active_users": [
    {
      "user_id": "user-123",
      "user_name": "John Doe",
      "user_color": "#10B981",
      "cursor_page": 1,
      "cursor_x": 100.5,
      "cursor_y": 250.3
    }
  ],
  "active_locks": [
    {
      "element_id": "element-uuid",
      "locked_by_user_id": "user-456",
      "expires_at": "2025-12-18T15:30:00Z"
    }
  ]
}
```

#### leave_document

Leave the current document room.

**Request:**
```javascript
socket.emit('leave_document', {}, (response) => {
  console.log(response);
});
```

```python
await sio.emit('leave_document', {})
```

```php
$socket->emit('leave_document', []);
```

**Response:**
```json
{
  "success": true
}
```

#### element:lock

Lock an element for editing.

**Request:**
```javascript
socket.emit('element:lock', {
  element_id: 'element-uuid'
}, (response) => {
  if (response.success) {
    console.log('Element locked until:', response.lock.expires_at);
  } else {
    console.log('Lock failed:', response.error);
  }
});
```

```python
response = await sio.emit('element:lock', {
    'element_id': 'element-uuid'
})
```

```php
$socket->emit('element:lock', [
    'element_id' => 'element-uuid'
], function($response) {
    if ($response['success']) {
        echo "Locked until: " . $response['lock']['expires_at'];
    }
});
```

**Response (Success):**
```json
{
  "success": true,
  "lock": {
    "element_id": "element-uuid",
    "expires_at": "2025-12-18T15:35:00Z"
  }
}
```

**Response (Failure):**
```json
{
  "success": false,
  "error": "Element locked by another user",
  "locked_by": "user-456",
  "expires_at": "2025-12-18T15:35:00Z"
}
```

#### element:unlock

Unlock an element.

**Request:**
```javascript
socket.emit('element:unlock', {
  element_id: 'element-uuid'
}, (response) => {
  console.log(response);
});
```

```python
await sio.emit('element:unlock', {
    'element_id': 'element-uuid'
})
```

```php
$socket->emit('element:unlock', [
    'element_id' => 'element-uuid'
]);
```

**Response:**
```json
{
  "success": true
}
```

#### cursor:move

Broadcast cursor position to other users.

**Request:**
```javascript
socket.emit('cursor:move', {
  page: 1,
  x: 100.5,
  y: 250.3
});
```

```python
await sio.emit('cursor:move', {
    'page': 1,
    'x': 100.5,
    'y': 250.3
})
```

```php
$socket->emit('cursor:move', [
    'page' => 1,
    'x' => 100.5,
    'y' => 250.3
]);
```

No response (fire and forget).

#### document:update

Broadcast a document update to other users.

**Request:**
```javascript
socket.emit('document:update', {
  update_type: 'element_modified',
  affected_elements: ['element-uuid-1', 'element-uuid-2'],
  affected_pages: [1, 2],
  timestamp: new Date().toISOString(),
  data: {
    element_id: 'element-uuid-1',
    property: 'text',
    value: 'New text content'
  }
});
```

```python
import datetime

await sio.emit('document:update', {
    'update_type': 'element_modified',
    'affected_elements': ['element-uuid-1'],
    'affected_pages': [1],
    'timestamp': datetime.datetime.utcnow().isoformat(),
    'data': {
        'element_id': 'element-uuid-1',
        'property': 'text',
        'value': 'New text content'
    }
})
```

```php
$socket->emit('document:update', [
    'update_type' => 'element_modified',
    'affected_elements' => ['element-uuid-1'],
    'affected_pages' => [1],
    'timestamp' => date('c'),
    'data' => [
        'element_id' => 'element-uuid-1',
        'property' => 'text',
        'value' => 'New text content'
    ]
]);
```

No response (fire and forget).

### Server → Client

#### user:joined

Emitted when a user joins the document.

```javascript
socket.on('user:joined', (data) => {
  console.log(`${data.user_name} joined with color ${data.user_color}`);
  // Add user to UI
});
```

```python
@sio.on('user:joined')
async def on_user_joined(data):
    print(f"{data['user_name']} joined")
```

```php
$socket->on('user:joined', function($data) {
    echo "{$data['user_name']} joined\n";
});
```

**Data:**
```json
{
  "user_id": "user-123",
  "user_name": "Jane Smith",
  "user_color": "#F59E0B",
  "timestamp": "2025-12-18T15:30:00Z"
}
```

#### user:left

Emitted when a user leaves the document.

```javascript
socket.on('user:left', (data) => {
  console.log(`${data.user_name} left`);
  // Remove user from UI
});
```

```python
@sio.on('user:left')
async def on_user_left(data):
    print(f"{data['user_name']} left")
```

```php
$socket->on('user:left', function($data) {
    echo "{$data['user_name']} left\n";
});
```

**Data:**
```json
{
  "user_id": "user-123",
  "user_name": "Jane Smith",
  "timestamp": "2025-12-18T15:35:00Z"
}
```

#### element:locked

Emitted when another user locks an element.

```javascript
socket.on('element:locked', (data) => {
  // Disable editing for this element
  disableElement(data.element_id);
});
```

```python
@sio.on('element:locked')
async def on_element_locked(data):
    print(f"Element {data['element_id']} locked by {data['locked_by_user_name']}")
```

```php
$socket->on('element:locked', function($data) {
    echo "Element locked: {$data['element_id']}\n";
});
```

**Data:**
```json
{
  "element_id": "element-uuid",
  "locked_by_user_id": "user-456",
  "locked_by_user_name": "Bob Johnson",
  "expires_at": "2025-12-18T15:35:00Z"
}
```

#### element:unlocked

Emitted when another user unlocks an element.

```javascript
socket.on('element:unlocked', (data) => {
  // Re-enable editing for this element
  enableElement(data.element_id);
});
```

```python
@sio.on('element:unlocked')
async def on_element_unlocked(data):
    print(f"Element {data['element_id']} unlocked")
```

```php
$socket->on('element:unlocked', function($data) {
    echo "Element unlocked: {$data['element_id']}\n";
});
```

**Data:**
```json
{
  "element_id": "element-uuid"
}
```

#### cursor:moved

Emitted when another user moves their cursor.

```javascript
socket.on('cursor:moved', (data) => {
  // Update cursor position in UI
  updateUserCursor(data.user_id, data.page, data.x, data.y);
});
```

```python
@sio.on('cursor:moved')
async def on_cursor_moved(data):
    print(f"{data['user_name']} cursor at ({data['x']}, {data['y']})")
```

```php
$socket->on('cursor:moved', function($data) {
    echo "Cursor moved: {$data['user_name']} at ({$data['x']}, {$data['y']})\n";
});
```

**Data:**
```json
{
  "user_id": "user-456",
  "user_name": "Bob Johnson",
  "page": 2,
  "x": 150.5,
  "y": 300.8
}
```

#### document:updated

Emitted when another user updates the document.

```javascript
socket.on('document:updated', (data) => {
  console.log(`Document updated by ${data.user_name}`);
  console.log(`Type: ${data.update_type}`);
  console.log('Affected elements:', data.affected_elements);

  // Refresh affected elements/pages
  refreshElements(data.affected_elements);
});
```

```python
@sio.on('document:updated')
async def on_document_updated(data):
    print(f"Document updated by {data['user_name']}")
    # Refresh UI
```

```php
$socket->on('document:updated', function($data) {
    echo "Document updated by {$data['user_name']}\n";
    echo "Type: {$data['update_type']}\n";
});
```

**Data:**
```json
{
  "user_id": "user-456",
  "user_name": "Bob Johnson",
  "update_type": "element_modified",
  "affected_elements": ["element-uuid-1"],
  "affected_pages": [1],
  "timestamp": "2025-12-18T15:30:00Z",
  "data": {
    "element_id": "element-uuid-1",
    "property": "text",
    "value": "New text content"
  }
}
```

## User Colors

The system automatically assigns one of 12 predefined colors to each user:

- Blue (#3B82F6)
- Green (#10B981)
- Amber (#F59E0B)
- Red (#EF4444)
- Purple (#8B5CF6)
- Pink (#EC4899)
- Cyan (#06B6D4)
- Orange (#F97316)
- Teal (#14B8A6)
- Indigo (#6366F1)
- Lime (#84CC16)
- Rose (#F43F5E)

Colors are assigned to avoid conflicts with other active users in the same document.

## Element Locking

### Lock Duration

Element locks expire after **5 minutes** of inactivity. Locks are automatically renewed when a user continues to interact with the element.

### Lock Behavior

- Only one user can hold a lock on an element at a time
- If a user disconnects, all their locks are immediately released
- Expired locks are automatically cleaned up every 5 minutes
- Users can manually release locks by emitting `element:unlock`

### Best Practices

1. **Lock before editing**: Always acquire a lock before modifying an element
2. **Release when done**: Release locks as soon as editing is complete
3. **Handle failures**: Check the response to handle cases where another user holds the lock
4. **Show visual feedback**: Display which user has locked an element

## Complete Example

### JavaScript/TypeScript

```javascript
import io from 'socket.io-client';

class CollaborationClient {
  constructor(documentId, authToken) {
    this.documentId = documentId;
    this.socket = io('http://localhost:8000/ws', {
      auth: { token: authToken }
    });

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Connection events
    this.socket.on('connect', () => {
      console.log('Connected to collaboration server');
      this.joinDocument();
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from collaboration server');
    });

    // User presence
    this.socket.on('user:joined', (data) => {
      this.onUserJoined(data);
    });

    this.socket.on('user:left', (data) => {
      this.onUserLeft(data);
    });

    // Element locking
    this.socket.on('element:locked', (data) => {
      this.onElementLocked(data);
    });

    this.socket.on('element:unlocked', (data) => {
      this.onElementUnlocked(data);
    });

    // Cursor tracking
    this.socket.on('cursor:moved', (data) => {
      this.onCursorMoved(data);
    });

    // Document updates
    this.socket.on('document:updated', (data) => {
      this.onDocumentUpdated(data);
    });
  }

  joinDocument() {
    this.socket.emit('join_document', {
      document_id: this.documentId
    }, (response) => {
      if (response.success) {
        console.log('Joined document:', response);
        this.userColor = response.session.user_color;
        this.initActiveUsers(response.active_users);
        this.initActiveLocks(response.active_locks);
      }
    });
  }

  async lockElement(elementId) {
    return new Promise((resolve) => {
      this.socket.emit('element:lock', {
        element_id: elementId
      }, (response) => {
        resolve(response);
      });
    });
  }

  unlockElement(elementId) {
    this.socket.emit('element:unlock', {
      element_id: elementId
    });
  }

  moveCursor(page, x, y) {
    this.socket.emit('cursor:move', { page, x, y });
  }

  broadcastUpdate(updateType, affectedElements, affectedPages, data) {
    this.socket.emit('document:update', {
      update_type: updateType,
      affected_elements: affectedElements,
      affected_pages: affectedPages,
      timestamp: new Date().toISOString(),
      data: data
    });
  }

  // Event handlers
  onUserJoined(data) {
    console.log(`${data.user_name} joined with color ${data.user_color}`);
    // Add user avatar to UI
  }

  onUserLeft(data) {
    console.log(`${data.user_name} left`);
    // Remove user avatar from UI
  }

  onElementLocked(data) {
    console.log(`Element ${data.element_id} locked by ${data.locked_by_user_name}`);
    // Disable element in UI
  }

  onElementUnlocked(data) {
    console.log(`Element ${data.element_id} unlocked`);
    // Enable element in UI
  }

  onCursorMoved(data) {
    // Update cursor position in UI
    console.log(`${data.user_name} cursor at page ${data.page}: (${data.x}, ${data.y})`);
  }

  onDocumentUpdated(data) {
    console.log(`Document updated by ${data.user_name}: ${data.update_type}`);
    // Refresh affected elements
  }

  initActiveUsers(users) {
    users.forEach(user => {
      console.log(`Active user: ${user.user_name} (${user.user_color})`);
    });
  }

  initActiveLocks(locks) {
    locks.forEach(lock => {
      console.log(`Locked element: ${lock.element_id} by ${lock.locked_by_user_id}`);
    });
  }

  disconnect() {
    this.socket.emit('leave_document', {});
    this.socket.disconnect();
  }
}

// Usage
const client = new CollaborationClient('doc-uuid-here', 'jwt-token-here');

// Example: Lock and edit an element
async function editElement(elementId, newText) {
  const lockResponse = await client.lockElement(elementId);

  if (lockResponse.success) {
    // Edit the element
    console.log('Editing element:', elementId);

    // Broadcast the change
    client.broadcastUpdate(
      'element_modified',
      [elementId],
      [1],
      { element_id: elementId, property: 'text', value: newText }
    );

    // Unlock when done
    client.unlockElement(elementId);
  } else {
    console.error('Cannot edit - locked by another user:', lockResponse.locked_by);
  }
}
```

### Python

```python
import socketio
import asyncio
from datetime import datetime

class CollaborationClient:
    def __init__(self, document_id: str, auth_token: str):
        self.document_id = document_id
        self.sio = socketio.AsyncClient()
        self.auth_token = auth_token
        self.setup_event_handlers()

    def setup_event_handlers(self):
        @self.sio.on('connect')
        async def on_connect():
            print('Connected to collaboration server')
            await self.join_document()

        @self.sio.on('disconnect')
        async def on_disconnect():
            print('Disconnected from collaboration server')

        @self.sio.on('user:joined')
        async def on_user_joined(data):
            print(f"{data['user_name']} joined with color {data['user_color']}")

        @self.sio.on('user:left')
        async def on_user_left(data):
            print(f"{data['user_name']} left")

        @self.sio.on('element:locked')
        async def on_element_locked(data):
            print(f"Element {data['element_id']} locked by {data['locked_by_user_name']}")

        @self.sio.on('element:unlocked')
        async def on_element_unlocked(data):
            print(f"Element {data['element_id']} unlocked")

        @self.sio.on('cursor:moved')
        async def on_cursor_moved(data):
            print(f"{data['user_name']} cursor at ({data['x']}, {data['y']})")

        @self.sio.on('document:updated')
        async def on_document_updated(data):
            print(f"Document updated by {data['user_name']}: {data['update_type']}")

    async def connect(self):
        await self.sio.connect(
            'http://localhost:8000/ws',
            auth={'token': self.auth_token}
        )

    async def join_document(self):
        response = await self.sio.call('join_document', {
            'document_id': self.document_id
        })

        if response['success']:
            print('Joined document:', response)
            self.user_color = response['session']['user_color']

    async def lock_element(self, element_id: str) -> dict:
        return await self.sio.call('element:lock', {
            'element_id': element_id
        })

    async def unlock_element(self, element_id: str):
        await self.sio.emit('element:unlock', {
            'element_id': element_id
        })

    async def move_cursor(self, page: int, x: float, y: float):
        await self.sio.emit('cursor:move', {
            'page': page,
            'x': x,
            'y': y
        })

    async def broadcast_update(self, update_type: str, affected_elements: list,
                              affected_pages: list, data: dict):
        await self.sio.emit('document:update', {
            'update_type': update_type,
            'affected_elements': affected_elements,
            'affected_pages': affected_pages,
            'timestamp': datetime.utcnow().isoformat(),
            'data': data
        })

    async def disconnect(self):
        await self.sio.emit('leave_document', {})
        await self.sio.disconnect()

# Usage
async def main():
    client = CollaborationClient('doc-uuid-here', 'jwt-token-here')
    await client.connect()

    # Lock and edit an element
    lock_response = await client.lock_element('element-uuid')
    if lock_response['success']:
        print('Element locked, editing...')

        # Broadcast the change
        await client.broadcast_update(
            'element_modified',
            ['element-uuid'],
            [1],
            {'element_id': 'element-uuid', 'property': 'text', 'value': 'New text'}
        )

        # Unlock when done
        await client.unlock_element('element-uuid')
    else:
        print('Cannot edit - locked by another user')

    # Keep connection alive
    await asyncio.sleep(60)
    await client.disconnect()

asyncio.run(main())
```

## Configuration

Environment variables for WebSocket configuration:

```bash
# Redis message queue for Socket.IO (required for multi-worker setup)
SOCKETIO_MESSAGE_QUEUE=redis://localhost:6379/2

# Database connection for collaboration state
DATABASE_URL=postgresql://gigapdf:gigapdf@localhost:5432/gigapdf
```

## Performance Considerations

1. **Redis Message Queue**: Required for horizontal scaling with multiple workers
2. **Lock Cleanup**: Runs every 5 minutes to remove expired locks
3. **Session Cleanup**: Inactive sessions are cleaned up after 60 minutes
4. **Database Indexing**: Indexes on `document_id` and `is_active` for fast queries

## Security

1. **JWT Authentication**: All connections require valid JWT tokens
2. **Authorization**: Users can only join documents they have access to (implement in application logic)
3. **Input Validation**: All event data is validated before processing
4. **Lock Ownership**: Users can only unlock elements they own

## Troubleshooting

### Connection Refused

- Check that WebSocket server is running
- Verify Redis is accessible at the configured URL
- Ensure JWT token is valid and not expired

### Locks Not Working

- Verify database migrations are up to date
- Check that cleanup task is running
- Ensure Redis message queue is configured for multi-worker setups

### Events Not Broadcasting

- Confirm users have joined the document room
- Check Redis connectivity for cross-worker messaging
- Verify Socket.IO client is properly connected

## Database Schema

### CollaborationSession Table

```sql
CREATE TABLE collaboration_sessions (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    user_color VARCHAR(7) DEFAULT '#3B82F6',
    socket_id VARCHAR(255),
    cursor_page INTEGER,
    cursor_x FLOAT,
    cursor_y FLOAT,
    is_active BOOLEAN DEFAULT TRUE,
    joined_at TIMESTAMP DEFAULT NOW(),
    last_seen_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_collab_sessions_document ON collaboration_sessions(document_id);
CREATE INDEX idx_collab_sessions_active ON collaboration_sessions(document_id, is_active);
```

### ElementLock Table

```sql
CREATE TABLE element_locks (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL,
    element_id UUID NOT NULL,
    locked_by_user_id VARCHAR(255) NOT NULL,
    locked_by_session_id UUID NOT NULL,
    locked_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_element_locks_document ON element_locks(document_id);
CREATE UNIQUE INDEX idx_element_locks_element ON element_locks(document_id, element_id);
```
