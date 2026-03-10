# @giga-pdf/logger - Quick Start Guide

## Installation

The package is part of the GigaPDF monorepo and installed automatically.

```bash
# In any app or package
pnpm install
```

## Importing

### Using the Default Logger

```typescript
import { logger } from '@giga-pdf/logger';

logger.info('Application started');
```

### Creating a Custom Logger

```typescript
import { createDefaultLogger } from '@giga-pdf/logger';

const logger = createDefaultLogger({
  enableRemote: true,
  remoteEndpoint: '/api/v1/logs',
  pretty: true,
});
```

### Manual Logger Configuration

```typescript
import {
  Logger,
  ConsoleTransport,
  RemoteTransport,
} from '@giga-pdf/logger';

const logger = new Logger({
  level: 'debug',
  transports: [
    new ConsoleTransport({ pretty: true }),
    new RemoteTransport({ endpoint: '/api/v1/logs' }),
  ],
});
```

## Basic Logging

### Log Levels

```typescript
logger.debug('Debug message', { detail: 'value' });
logger.info('Info message', { status: 'ok' });
logger.warn('Warning message', { code: 'WARN001' });
logger.error('Error message', error, { context: 'additional' });
logger.fatal('Fatal error', error, { critical: true });
```

### Structured Data

```typescript
logger.info('User action', {
  action: 'click',
  button: 'save',
  timestamp: Date.now(),
});
```

## Context Management

### Setting Context

```typescript
// Global context
logger.setContext({
  requestId: 'req-123',
  userId: 'user-456',
});

logger.info('Action performed'); // Includes context automatically

// Clear specific context
logger.clearContext('userId');

// Clear all context
logger.clearAllContext();
```

### Child Loggers

```typescript
const parentLogger = logger.child({ module: 'auth' });
const childLogger = parentLogger.child({ operation: 'login' });

childLogger.info('Login attempt');
// Context: { module: 'auth', operation: 'login' }
```

## React Integration

### Basic Component Logging

```typescript
import { useLogger } from '@giga-pdf/logger';

function MyComponent({ userId }) {
  const logger = useLogger({
    component: 'MyComponent',
    context: { userId },
  });

  const handleClick = () => {
    logger.info('Button clicked');
  };

  return <button onClick={handleClick}>Click me</button>;
}
```

### Performance Tracking

```typescript
import { usePerformanceTracking } from '@giga-pdf/logger';

function ExpensiveComponent() {
  usePerformanceTracking('ExpensiveComponent:render');

  return <div>Content</div>;
}
```

### Lifecycle Tracking

```typescript
import { useComponentLifecycle } from '@giga-pdf/logger';

function MyComponent() {
  useComponentLifecycle('MyComponent');

  return <div>Content</div>;
}
```

## Performance Measurement

### Manual Timer

```typescript
const stopTimer = logger.startTimer('dataProcessing');

// Do work...
processData();

stopTimer(); // Logs: "Performance: dataProcessing" with duration
```

### Async Measurement

```typescript
const data = await logger.measureAsync('fetchUser', async () => {
  return await api.getUser(userId);
});
```

### Sync Measurement

```typescript
const total = logger.measure('calculateTotal', () => {
  return items.reduce((sum, item) => sum + item.price, 0);
});
```

## Error Handling

### Basic Error Logging

```typescript
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed', error);
}
```

### Error with Context

```typescript
try {
  await saveDocument(doc);
} catch (error) {
  logger.error('Failed to save document', error, {
    documentId: doc.id,
    userId: currentUser.id,
    operation: 'save',
  });
}
```

### Custom Errors

```typescript
class ValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public code: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

try {
  throw new ValidationError('Invalid email', 'email', 'VAL001');
} catch (error) {
  logger.warn('Validation failed', error);
  // Logs: name, message, stack, field, code
}
```

## Real-World Examples

### API Client

```typescript
class APIClient {
  private logger = logger.child({ module: 'api-client' });

  async request(method: string, path: string) {
    this.logger.debug('API request', { method, path });

    try {
      return await this.logger.measureAsync('api-request', async () => {
        const response = await fetch(`${this.baseURL}${path}`, {
          method,
        });
        return response.json();
      });
    } catch (error) {
      this.logger.error('API request failed', error, { method, path });
      throw error;
    }
  }
}
```

### Document Editor

```typescript
function DocumentEditor({ documentId }) {
  const logger = useLogger({
    component: 'DocumentEditor',
    context: { documentId },
  });

  const handleSave = async () => {
    logger.info('Saving document');

    try {
      await logger.measureAsync('saveDocument', async () => {
        await api.saveDocument(documentId);
      });
      logger.info('Document saved successfully');
    } catch (error) {
      logger.error('Save failed', error);
    }
  };

  return <button onClick={handleSave}>Save</button>;
}
```

### WebSocket Connection

```typescript
class WebSocketManager {
  private logger = logger.child({ module: 'websocket' });

  connect(url: string) {
    this.logger.info('Connecting', { url });

    const ws = new WebSocket(url);

    ws.onopen = () => {
      this.logger.info('Connected');
    };

    ws.onerror = (error) => {
      this.logger.error('Connection error', error);
    };

    ws.onclose = (event) => {
      this.logger.info('Connection closed', {
        code: event.code,
        reason: event.reason,
      });
    };

    return ws;
  }
}
```

## Configuration Tips

### Development vs Production

```typescript
// Next.js app - next.config.js
module.exports = {
  env: {
    // Development: debug level, pretty console
    // Production: info level, JSON format, remote logging
    NEXT_PUBLIC_LOG_LEVEL: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
};
```

### Custom Transport Configuration

```typescript
// Console only in development
const logger = new Logger();

if (process.env.NODE_ENV === 'development') {
  logger.addTransport(new ConsoleTransport({ pretty: true }));
} else {
  logger.addTransport(new ConsoleTransport({ pretty: false }));
  logger.addTransport(
    new RemoteTransport({
      endpoint: '/api/v1/logs',
      level: 'error',
      batchSize: 20,
      flushInterval: 10000,
    })
  );
}
```

## Best Practices

### 1. Use Appropriate Log Levels

```typescript
// Debug: Detailed information for debugging
logger.debug('Processing item', { item });

// Info: General informational messages
logger.info('User logged in', { userId });

// Warn: Warning messages (recoverable issues)
logger.warn('Rate limit approaching', { remaining: 10 });

// Error: Error messages (handled errors)
logger.error('Failed to load data', error);

// Fatal: Fatal errors (crashes)
logger.fatal('Application crash', error);
```

### 2. Always Add Context

```typescript
// Bad
logger.info('Document saved');

// Good
logger.info('Document saved', {
  documentId: 'doc-123',
  userId: 'user-456',
  duration: 234,
});
```

### 3. Use Child Loggers for Modules

```typescript
// auth.ts
export const authLogger = logger.child({ module: 'auth' });

// api.ts
export const apiLogger = logger.child({ module: 'api' });

// storage.ts
export const storageLogger = logger.child({ module: 'storage' });
```

### 4. Measure Critical Operations

```typescript
// Measure async operations
const result = await logger.measureAsync('criticalOperation', async () => {
  return await performOperation();
});

// Measure sync operations
const value = logger.measure('heavyCalculation', () => {
  return calculate();
});
```

### 5. Structure Your Errors

```typescript
try {
  await operation();
} catch (error) {
  logger.error('Operation failed', error, {
    operation: 'userUpdate',
    userId: user.id,
    attempt: retryCount,
    timestamp: Date.now(),
  });
}
```

## Troubleshooting

### Logs Not Appearing

1. Check log level configuration
2. Verify transports are added
3. Check browser console filters

### Remote Logging Not Working

1. Verify endpoint is correct
2. Check network tab for requests
3. Ensure backend endpoint exists
4. Verify log level meets remote threshold

### TypeScript Errors

1. Ensure proper types are imported
2. Check TypeScript version compatibility
3. Verify lib includes DOM for browser APIs

## Next Steps

1. Read the [README.md](./README.md) for comprehensive documentation
2. Check [examples.md](./examples.md) for more examples
3. Review [STRUCTURE.md](./STRUCTURE.md) for package architecture
4. Implement backend `/api/v1/logs` endpoint to receive logs
