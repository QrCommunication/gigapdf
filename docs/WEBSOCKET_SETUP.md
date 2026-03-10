# WebSocket Collaboration Setup Guide

This guide walks you through setting up the WebSocket collaboration system for Giga-PDF.

## Prerequisites

1. **Redis** - Required for Socket.IO message queue
2. **PostgreSQL** - Database for collaboration state
3. **Python 3.11+** - Runtime environment

## Installation

### 1. Install Dependencies

The required packages are already in `requirements.txt`:

```bash
pip install -r requirements.txt
```

Key dependencies:
- `python-socketio>=5.10.0` - WebSocket server
- `redis>=5.0.0` - Message queue
- `SQLAlchemy>=2.0.25` - Database ORM
- `asyncpg` - Async PostgreSQL driver

### 2. Configure Redis

Update your `.env` file with Redis configuration:

```bash
# Redis for general caching
REDIS_URL=redis://localhost:6379/0

# Redis for Socket.IO message queue (different database)
SOCKETIO_MESSAGE_QUEUE=redis://localhost:6379/2
```

**Note:** Use different Redis databases (0, 1, 2) to avoid conflicts.

### 3. Configure Database

Ensure your database connection is configured:

```bash
DATABASE_URL=postgresql://gigapdf:gigapdf@localhost:5432/gigapdf
```

### 4. Run Database Migration

Create the collaboration tables:

```bash
# Run Alembic migration
alembic upgrade head
```

Or if this is the first migration:

```bash
# Initialize Alembic
alembic init migrations

# Generate migration
alembic revision --autogenerate -m "Add collaboration tables"

# Apply migration
alembic upgrade head
```

## Verification

### 1. Start Redis

```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or using system service
sudo systemctl start redis

# Verify Redis is running
redis-cli ping
# Should return: PONG
```

### 2. Start the Server

```bash
# Development mode
python -m app.main

# Or with uvicorn
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Check WebSocket Endpoint

The WebSocket server should be available at:

```
ws://localhost:8000/ws/socket.io
```

You can test connectivity:

```bash
curl http://localhost:8000/ws/socket.io/?transport=polling
```

Should return Socket.IO polling response.

### 4. Test with Example Client

```bash
# Get a test JWT token (see examples/README.md)
export JWT_TOKEN="your-test-token"
export DOCUMENT_ID="test-doc-uuid"

# Run Python example
python examples/websocket_client.py \
  --document-id $DOCUMENT_ID \
  --token $JWT_TOKEN \
  --demo
```

## Architecture Overview

```
┌─────────────────┐
│   Client App    │
│  (Browser/App)  │
└────────┬────────┘
         │ WebSocket
         │ /ws/socket.io
┌────────▼────────┐
│   FastAPI App   │
│  + Socket.IO    │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼──────┐
│ Redis │ │PostgreSQL│
│ Queue │ │  DB     │
└───────┘ └─────────┘
```

### Component Responsibilities

1. **Socket.IO Server** (`app/api/websocket.py`)
   - Handles WebSocket connections
   - Routes events to handlers
   - Broadcasts to rooms

2. **CollaborationManager** (`app/services/collaboration_service.py`)
   - Manages sessions in database
   - Handles element locking logic
   - Assigns user colors

3. **Redis Message Queue**
   - Enables multi-worker deployments
   - Synchronizes events across workers
   - Stores temporary session data

4. **PostgreSQL Database**
   - Persists collaboration sessions
   - Stores element locks
   - Tracks user presence

## Production Deployment

### Multiple Workers

For production with multiple workers, Redis message queue is **required**:

```bash
# Start with 4 workers
uvicorn app.main:app --workers 4 --host 0.0.0.0 --port 8000
```

Without Redis, events will only broadcast to users on the same worker.

### Environment Variables

```bash
# Production settings
APP_ENV=production
APP_DEBUG=false

# Redis with password
REDIS_URL=redis://:password@redis-host:6379/0
SOCKETIO_MESSAGE_QUEUE=redis://:password@redis-host:6379/2

# Database with connection pooling
DATABASE_URL=postgresql://user:pass@db-host:5432/gigapdf
DATABASE_POOL_SIZE=20
```

### CORS Configuration

Update CORS settings in production:

```python
# app/main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://yourdomain.com"],  # Specific domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### WebSocket Path

The WebSocket is mounted at `/ws`. Clients connect to:

```
wss://yourdomain.com/ws/socket.io
```

### Load Balancing

When using a load balancer (nginx, HAProxy), enable sticky sessions:

**Nginx example:**

```nginx
upstream gigapdf {
    ip_hash;  # Sticky sessions
    server app1:8000;
    server app2:8000;
    server app3:8000;
}

server {
    location /ws/ {
        proxy_pass http://gigapdf;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket timeout
        proxy_read_timeout 86400;
    }
}
```

## Monitoring

### Check Active Sessions

```sql
SELECT
    document_id,
    COUNT(*) as active_users
FROM collaboration_sessions
WHERE is_active = true
GROUP BY document_id;
```

### Check Active Locks

```sql
SELECT
    document_id,
    element_id,
    locked_by_user_id,
    expires_at
FROM element_locks
WHERE expires_at > NOW()
ORDER BY expires_at;
```

### Redis Monitoring

```bash
# Check connected clients
redis-cli CLIENT LIST

# Monitor commands
redis-cli MONITOR

# Check memory usage
redis-cli INFO memory
```

## Troubleshooting

### Redis Connection Errors

```
Error: ConnectionRefusedError: [Errno 111] Connection refused
```

**Solution:**
- Ensure Redis is running: `redis-cli ping`
- Check Redis URL in `.env`
- Verify Redis is listening on correct port

### Database Migration Errors

```
Error: relation "collaboration_sessions" does not exist
```

**Solution:**
```bash
# Run migration
alembic upgrade head

# Or manually create tables
python -c "from app.core.database import init_database; import asyncio; asyncio.run(init_database())"
```

### WebSocket Not Connecting

**Check:**
1. Server is running: `curl http://localhost:8000/health`
2. WebSocket path: `curl http://localhost:8000/ws/socket.io/?transport=polling`
3. JWT token is valid
4. CORS settings allow your origin

### Events Not Broadcasting

**Check:**
1. Redis is configured: `SOCKETIO_MESSAGE_QUEUE` in `.env`
2. Multiple workers can access same Redis instance
3. Users have joined the document room
4. Check logs for errors: `tail -f logs/gigapdf.log`

### Lock Cleanup Not Running

The cleanup task runs automatically every 5 minutes. To manually trigger:

```python
from app.services.collaboration_service import collaboration_manager
import asyncio

async def cleanup():
    locks = await collaboration_manager.cleanup_expired_locks()
    sessions = await collaboration_manager.cleanup_inactive_sessions()
    print(f"Cleaned {locks} locks, {sessions} sessions")

asyncio.run(cleanup())
```

## Performance Tuning

### Redis

```bash
# Increase max clients
redis-cli CONFIG SET maxclients 10000

# Enable persistence (optional)
redis-cli CONFIG SET save "900 1 300 10 60 10000"
```

### Database

```sql
-- Add indexes if not already present
CREATE INDEX IF NOT EXISTS idx_collab_sessions_document ON collaboration_sessions(document_id);
CREATE INDEX IF NOT EXISTS idx_collab_sessions_active ON collaboration_sessions(document_id, is_active);
CREATE INDEX IF NOT EXISTS idx_element_locks_document ON element_locks(document_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_element_locks_element ON element_locks(document_id, element_id);
```

### Connection Pooling

```bash
# Increase database pool size
DATABASE_POOL_SIZE=50

# Increase Redis connection pool
# (automatically managed by redis-py)
```

## Security Considerations

1. **JWT Validation**
   - Always validate JWT signatures
   - Check token expiration
   - Verify issuer and audience

2. **Rate Limiting**
   - Implement rate limits on WebSocket events
   - Limit cursor updates per second
   - Throttle document updates

3. **Authorization**
   - Verify user has access to document before joining
   - Implement document-level permissions
   - Audit lock operations

4. **Input Validation**
   - Validate all event data
   - Sanitize user-provided strings
   - Limit message sizes

## Next Steps

- [WebSocket Collaboration API Documentation](./WEBSOCKET_COLLABORATION.md)
- [Example Clients](../examples/README.md)
- [Integration Tests](../tests/integration/test_websocket_collaboration.py)

## Support

For issues or questions:
- Check the logs: `tail -f logs/gigapdf.log`
- Review error messages in browser console
- Test with example clients first
- Enable debug logging: `APP_DEBUG=true`
