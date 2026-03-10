# WebSocket Collaboration - Quick Start Guide

Get the WebSocket collaboration system running in 5 minutes.

## Prerequisites

- Python 3.11+
- Redis running on localhost:6379
- PostgreSQL running

## Step 1: Install Dependencies

```bash
pip install python-socketio redis asyncpg
```

## Step 2: Configure Environment

Create or update `.env`:

```bash
# Redis for Socket.IO
SOCKETIO_MESSAGE_QUEUE=redis://localhost:6379/2

# Database
DATABASE_URL=postgresql://gigapdf:gigapdf@localhost:5432/gigapdf

# JWT (if not already set)
AUTH_JWT_PUBLIC_KEY=your-public-key
AUTH_JWT_ALGORITHM=RS256
AUTH_JWT_AUDIENCE=giga-pdf
```

## Step 3: Run Migration

```bash
alembic upgrade head
```

## Step 4: Start Server

```bash
python -m app.main
```

You should see:

```
INFO - WebSocket server mounted at /ws
INFO - WebSocket cleanup task started
INFO - Uvicorn running on http://0.0.0.0:8000
```

## Step 5: Test Connection

### Option A: Using Python Example

```bash
# Get a JWT token from your auth system
export JWT_TOKEN="your-jwt-token-here"

# Run example client
python examples/websocket_client.py \
  --document-id "test-doc-123" \
  --token $JWT_TOKEN \
  --demo
```

### Option B: Using JavaScript Example

```bash
npm install socket.io-client

node examples/websocket_client.js \
  --document-id "test-doc-123" \
  --token $JWT_TOKEN \
  --demo
```

### Option C: Using Browser

```html
<script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
<script>
  const socket = io('http://localhost:8000/ws', {
    auth: { token: 'your-jwt-token' }
  });

  socket.on('connect', () => {
    console.log('Connected!');

    socket.emit('join_document', {
      document_id: 'test-doc-123'
    }, (response) => {
      console.log('Joined:', response);
    });
  });

  socket.on('user:joined', (data) => {
    console.log('User joined:', data.user_name);
  });
</script>
```

## Common Commands

### Check Redis

```bash
redis-cli ping
# Should return: PONG
```

### Check Database

```bash
psql -U gigapdf -d gigapdf -c "SELECT COUNT(*) FROM collaboration_sessions;"
```

### View Logs

```bash
# If using systemd
journalctl -u gigapdf -f

# Or direct output
tail -f logs/gigapdf.log
```

### Test WebSocket Endpoint

```bash
curl http://localhost:8000/ws/socket.io/?transport=polling
```

## Troubleshooting

### "Redis connection refused"

```bash
# Start Redis
docker run -d -p 6379:6379 redis:7-alpine
# OR
sudo systemctl start redis
```

### "Table collaboration_sessions does not exist"

```bash
# Run migration
alembic upgrade head
```

### "Authentication failed"

- Verify JWT token is valid and not expired
- Check AUTH_JWT_PUBLIC_KEY matches your auth service
- Ensure token has required claims (sub, name/email)

## Next Steps

1. Read [Full Documentation](docs/WEBSOCKET_COLLABORATION.md)
2. Review [Setup Guide](docs/WEBSOCKET_SETUP.md)
3. Explore [Examples](examples/README.md)
4. Check [Implementation Summary](WEBSOCKET_IMPLEMENTATION_SUMMARY.md)

## Quick Integration Example

```javascript
// client.js
import io from 'socket.io-client';

const socket = io('http://localhost:8000/ws', {
  auth: { token: authToken }
});

// Join document
socket.emit('join_document', { document_id: docId }, (response) => {
  if (response.success) {
    console.log('Your color:', response.session.user_color);
  }
});

// Lock element before editing
socket.emit('element:lock', { element_id: elementId }, (response) => {
  if (response.success) {
    // Now you can edit
    editElement(elementId);

    // Broadcast update
    socket.emit('document:update', {
      update_type: 'element_modified',
      affected_elements: [elementId],
      affected_pages: [pageNumber],
      data: { property: 'text', value: newText }
    });

    // Unlock when done
    socket.emit('element:unlock', { element_id: elementId });
  } else {
    alert('Element locked by another user');
  }
});

// Listen for other users
socket.on('user:joined', (data) => {
  showUserJoined(data.user_name, data.user_color);
});

socket.on('cursor:moved', (data) => {
  updateCursor(data.user_id, data.x, data.y);
});
```

That's it! You now have real-time collaboration running.
