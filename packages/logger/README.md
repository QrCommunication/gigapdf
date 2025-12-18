# @giga-pdf/logger

Structured logging package for GigaPDF frontend applications.

## Features

- **Multiple log levels**: debug, info, warn, error, fatal
- **Structured logging**: JSON format for production, pretty console for development
- **Remote transport**: Send logs to backend API endpoint
- **Context support**: Track requestId, userId, documentId across log entries
- **Performance tracking**: Built-in utilities for measuring operation performance
- **Error serialization**: Properly serialize Error objects with stack traces
- **React hooks**: Easy integration with React components
- **TypeScript**: Full type safety with strict mode
- **Browser-compatible**: No Node.js dependencies

## Installation

```bash
pnpm add @giga-pdf/logger
```

## Quick Start

### Basic Usage

```typescript
import { logger } from '@giga-pdf/logger';

// Simple logging
logger.info('Application started');
logger.debug('Debug information', { userId: 123 });
logger.warn('Warning message');
logger.error('Error occurred', error);
logger.fatal('Fatal error', error);
```

### Create Custom Logger

```typescript
import { Logger, ConsoleTransport, RemoteTransport } from '@giga-pdf/logger';

const logger = new Logger({
  level: 'info',
  transports: [
    new ConsoleTransport({ pretty: true }),
    new RemoteTransport({
      endpoint: '/api/v1/logs',
      level: 'error',
    }),
  ],
});
```

### Using Context

```typescript
// Set global context
logger.setContext({ requestId: 'req-123', userId: 'user-456' });

logger.info('User action'); // Will include context

// Clear specific context
logger.clearContext('userId');

// Create child logger with additional context
const childLogger = logger.child({ documentId: 'doc-789' });
childLogger.info('Document updated'); // Includes parent + child context
```

### Performance Tracking

```typescript
// Using timer
const stopTimer = logger.startTimer('dataFetch');
await fetchData();
stopTimer(); // Logs: "Performance: dataFetch" with duration

// Using measureAsync
const data = await logger.measureAsync('fetchUser', async () => {
  return await api.getUser(userId);
});

// Using measure (sync)
const result = logger.measure('calculateTotal', () => {
  return items.reduce((sum, item) => sum + item.price, 0);
});
```

## React Hooks

### useLogger

```typescript
import { useLogger } from '@giga-pdf/logger';

function MyComponent({ userId }) {
  const logger = useLogger({
    component: 'MyComponent',
    context: { userId },
  });

  useEffect(() => {
    logger.info('Component mounted');
    return () => logger.info('Component unmounted');
  }, [logger]);

  const handleClick = () => {
    logger.debug('Button clicked');
  };

  return <button onClick={handleClick}>Click me</button>;
}
```

### usePerformanceTracking

```typescript
import { usePerformanceTracking } from '@giga-pdf/logger';

function ExpensiveComponent() {
  usePerformanceTracking('ExpensiveComponent:render');

  // Logs render time on each render
  return <div>Expensive content</div>;
}
```

### useComponentLifecycle

```typescript
import { useComponentLifecycle } from '@giga-pdf/logger';

function MyComponent() {
  useComponentLifecycle('MyComponent');

  // Automatically logs mount and unmount
  return <div>Content</div>;
}
```

## Configuration

### Environment Variables

- `NEXT_PUBLIC_LOG_LEVEL`: Minimum log level (default: "debug" in dev, "info" in prod)
- `NODE_ENV`: Used to determine default behavior

### Log Levels

In ascending order of severity:

1. `debug` - Detailed debug information
2. `info` - General informational messages
3. `warn` - Warning messages
4. `error` - Error messages
5. `fatal` - Fatal errors that may crash the application

### Console Transport Options

```typescript
new ConsoleTransport({
  pretty: true, // Use pretty formatting (default: true)
  level: 'debug', // Minimum level to output (default: 'debug')
});
```

### Remote Transport Options

```typescript
new RemoteTransport({
  endpoint: '/api/v1/logs', // API endpoint (default: '/api/v1/logs')
  level: 'error', // Minimum level to send (default: 'error')
  batchSize: 10, // Batch size before sending (default: 10)
  flushInterval: 5000, // Flush interval in ms (default: 5000)
  enableBatching: true, // Enable batching (default: true)
  headers: {}, // Custom headers (default: {})
});
```

## Advanced Usage

### Custom Formatters

```typescript
import { JsonFormatter, PrettyFormatter } from '@giga-pdf/logger';

const jsonFormatter = new JsonFormatter();
const prettyFormatter = new PrettyFormatter();

const entry = {
  timestamp: new Date().toISOString(),
  level: 'info',
  message: 'Test message',
};

console.log(jsonFormatter.format(entry));
// {"timestamp":"...","level":"info","message":"Test message"}

console.log(prettyFormatter.format(entry));
// Returns formatted message with styles
```

### Error Serialization

```typescript
try {
  throw new Error('Something went wrong');
} catch (error) {
  logger.error('Operation failed', error, {
    operation: 'userUpdate',
    userId: 123,
  });
  // Logs with full stack trace and error details
}
```

### Manual Transport Flushing

```typescript
import { RemoteTransport } from '@giga-pdf/logger';

const remoteTransport = new RemoteTransport();
logger.addTransport(remoteTransport);

// Flush immediately
await remoteTransport.flush();

// Cleanup
remoteTransport.destroy();
```

## API Reference

### Logger

- `debug(message, data?)` - Log debug message
- `info(message, data?)` - Log info message
- `warn(message, data?)` - Log warning message
- `error(message, error?, data?)` - Log error message
- `fatal(message, error?, data?)` - Log fatal error
- `setContext(context)` - Set logging context
- `getContext()` - Get current context
- `clearContext(key)` - Clear specific context field
- `clearAllContext()` - Clear all context
- `addTransport(transport)` - Add a transport
- `startTimer(operation)` - Start performance timer
- `measureAsync(operation, fn)` - Measure async operation
- `measure(operation, fn)` - Measure sync operation
- `child(context)` - Create child logger

### Types

```typescript
interface LogContext {
  requestId?: string;
  userId?: string;
  documentId?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  data?: Record<string, unknown>;
  error?: SerializedError;
  performance?: PerformanceInfo;
}
```

## Best Practices

1. **Use appropriate log levels**: Reserve `error` and `fatal` for actual errors
2. **Add context**: Include requestId, userId, etc. for traceability
3. **Structure your data**: Use the data parameter for structured information
4. **Performance tracking**: Measure critical operations
5. **Component logging**: Use hooks for React component logging
6. **Child loggers**: Create child loggers for scoped context
7. **Remote logging**: Only send errors remotely to avoid overwhelming the backend

## License

Private package for GigaPDF project.
