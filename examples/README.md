# Giga-PDF Examples

This directory contains example clients and scripts demonstrating how to use the Giga-PDF API.

## WebSocket Collaboration Examples

### Python Client

The Python example demonstrates real-time collaboration using Socket.IO.

**Installation:**

```bash
pip install python-socketio
```

**Usage:**

```bash
# Basic connection
python examples/websocket_client.py \
  --document-id "your-document-uuid" \
  --token "your-jwt-token"

# Run with demo interactions
python examples/websocket_client.py \
  --document-id "your-document-uuid" \
  --token "your-jwt-token" \
  --demo

# Custom server URL
python examples/websocket_client.py \
  --server-url "http://your-server:8000/ws" \
  --document-id "your-document-uuid" \
  --token "your-jwt-token"
```

**Features:**

- User presence tracking (join/leave notifications)
- Element locking/unlocking
- Cursor position broadcasting
- Document update notifications
- Automatic reconnection handling

### JavaScript/Node.js Client

The JavaScript example works with Node.js and can be adapted for browser use.

**Installation:**

```bash
npm install socket.io-client
```

**Usage:**

```bash
# Basic connection
node examples/websocket_client.js \
  --document-id "your-document-uuid" \
  --token "your-jwt-token"

# Run with demo interactions
node examples/websocket_client.js \
  --document-id "your-document-uuid" \
  --token "your-jwt-token" \
  --demo

# Custom server URL
node examples/websocket_client.js \
  --server-url "http://your-server:8000/ws" \
  --document-id "your-document-uuid" \
  --token "your-jwt-token"
```

**Features:**

- Same features as Python client
- Can be easily adapted for React/Vue/Angular
- ES6 class-based implementation

## Getting a JWT Token

The WebSocket requires a valid JWT token for authentication. You can get a token by:

1. **Using your authentication service** (BetterAuth, Laravel, etc.)
2. **For testing only**, you can create a test token:

```python
# test_token.py
import jwt
from datetime import datetime, timedelta

secret_key = "your-secret-key"  # Use your app_secret_key

payload = {
    "sub": "test-user-123",  # User ID
    "name": "Test User",
    "email": "test@example.com",
    "exp": datetime.utcnow() + timedelta(hours=24),  # Expires in 24 hours
    "iat": datetime.utcnow(),
    "aud": "giga-pdf",
}

token = jwt.encode(payload, secret_key, algorithm="HS256")
print(token)
```

**Note:** For production, always use your authentication service to generate tokens.

## Example Workflow

### 1. Connect to Document

```javascript
const client = new CollaborationClient(
  'http://localhost:8000/ws',
  'doc-uuid',
  'jwt-token'
);

// Connection is automatic on instantiation
```

### 2. Lock an Element Before Editing

```javascript
// Try to lock the element
const locked = await client.lockElement('element-uuid');

if (locked) {
  // Edit the element
  console.log('You can now edit the element');

  // Broadcast the change
  client.broadcastUpdate(
    'element_modified',
    ['element-uuid'],
    [1],
    { property: 'text', value: 'New content' }
  );

  // Unlock when done
  await client.unlockElement('element-uuid');
} else {
  console.log('Element is locked by another user');
}
```

### 3. Track Cursor Movements

```javascript
// Move your cursor
client.moveCursor(1, 150.5, 300.8);

// Listen for other users' cursors
socket.on('cursor:moved', (data) => {
  updateCursor(data.user_id, data.page, data.x, data.y);
});
```

### 4. Handle User Presence

```javascript
// User joined
socket.on('user:joined', (data) => {
  console.log(`${data.user_name} joined with color ${data.user_color}`);
  addUserToUI(data);
});

// User left
socket.on('user:left', (data) => {
  console.log(`${data.user_name} left`);
  removeUserFromUI(data.user_id);
});
```

## Browser Usage (JavaScript)

To use the JavaScript client in a browser:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Giga-PDF Collaboration</title>
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
</head>
<body>
  <script>
    const socket = io('http://localhost:8000/ws', {
      auth: {
        token: 'your-jwt-token'
      }
    });

    socket.on('connect', () => {
      console.log('Connected!');

      // Join document
      socket.emit('join_document', {
        document_id: 'your-doc-uuid'
      }, (response) => {
        if (response.success) {
          console.log('Joined:', response);
        }
      });
    });

    // Listen for events
    socket.on('user:joined', (data) => {
      console.log('User joined:', data);
    });

    socket.on('cursor:moved', (data) => {
      console.log('Cursor moved:', data);
    });
  </script>
</body>
</html>
```

## Common Issues

### Connection Refused

- Ensure the Giga-PDF server is running
- Check that WebSocket is mounted at `/ws`
- Verify Redis is running (required for Socket.IO)

### Authentication Failed

- Check that your JWT token is valid and not expired
- Verify the token matches the expected format
- Ensure the JWT secret/public key is correct in server config

### Events Not Received

- Confirm you've joined the document room (`join_document` event)
- Check that other users are in the same document
- Verify Redis is configured for multi-worker setups

## More Examples

For more detailed documentation, see:

- [WebSocket Collaboration Documentation](../docs/WEBSOCKET_COLLABORATION.md)
- [API Documentation](http://localhost:8000/api/docs)

## Contributing

To add new examples:

1. Create a new file in this directory
2. Add documentation to this README
3. Include error handling and logging
4. Provide clear usage instructions
