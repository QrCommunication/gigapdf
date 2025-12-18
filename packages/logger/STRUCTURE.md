# @giga-pdf/logger Package Structure

## Directory Tree

```
packages/logger/
├── package.json                    # Package configuration with tsup build
├── tsconfig.json                   # TypeScript configuration
├── README.md                       # Comprehensive documentation
├── examples.md                     # Usage examples
├── .gitignore                      # Git ignore rules
├── src/
│   ├── index.ts                   # Main entry point & exports
│   ├── logger.ts                  # Core Logger class
│   ├── context.ts                 # Context management
│   ├── transports/
│   │   ├── index.ts              # Transport exports
│   │   ├── console.ts            # Browser console output
│   │   └── remote.ts             # Backend API transport
│   ├── formatters/
│   │   ├── index.ts              # Formatter exports
│   │   ├── json.ts               # JSON formatter
│   │   └── pretty.ts             # Pretty console formatter
│   └── hooks/
│       ├── index.ts              # Hook exports
│       └── use-logger.ts         # React hooks
```

## File Descriptions

### Core Files

- **package.json**: Package configuration with tsup for building CJS/ESM bundles
- **tsconfig.json**: TypeScript strict mode configuration
- **src/index.ts**: Main entry point with all exports and default logger factory

### Logger Core

- **src/logger.ts**: Main Logger class with:
  - Log levels: debug, info, warn, error, fatal
  - Context management
  - Performance tracking utilities
  - Error serialization
  - Child logger creation
  - Transport management

- **src/context.ts**: ContextManager for:
  - Request tracing (requestId, userId, documentId)
  - Contextual logging
  - Context inheritance

### Transports

- **src/transports/console.ts**: ConsoleTransport
  - Pretty formatting for development
  - JSON formatting for production
  - Log level filtering
  - Browser console integration

- **src/transports/remote.ts**: RemoteTransport
  - Batch logging to backend API
  - Automatic flushing
  - Configurable endpoints and headers
  - Error-only remote logging by default

### Formatters

- **src/formatters/json.ts**: JsonFormatter
  - Structured JSON output
  - Circular reference handling
  - Log aggregation friendly

- **src/formatters/pretty.ts**: PrettyFormatter
  - Colorized console output
  - Emoji indicators
  - Context highlighting
  - Performance metrics display

### React Integration

- **src/hooks/use-logger.ts**: React hooks
  - `useLogger`: Component-level logging with context
  - `usePerformanceTracking`: Render performance tracking
  - `useComponentLifecycle`: Lifecycle event logging

## Features Implemented

### 1. Log Levels
- debug, info, warn, error, fatal
- Level-based filtering
- Environment-based defaults

### 2. Structured Logging
- JSON format for production
- Pretty console for development
- Full type safety

### 3. Context Support
- requestId tracking
- userId tracking
- documentId tracking
- Custom context fields
- Context inheritance

### 4. Remote Transport
- POST to /api/v1/logs endpoint
- Batching (default: 10 entries)
- Auto-flush (default: 5s)
- Custom headers support
- Error-level filtering

### 5. Browser Compatible
- No Node.js dependencies
- Uses fetch API
- Performance API integration
- beforeunload handling

### 6. Error Serialization
- Stack trace capture
- Error object properties
- Custom error fields
- Safe serialization

### 7. Performance Logging
- Timer utilities
- Async operation measurement
- Sync operation measurement
- Duration tracking

### 8. TypeScript Support
- Strict mode enabled
- Full type definitions
- Generic support
- Type-safe exports

### 9. Build System
- tsup for bundling
- CJS + ESM outputs
- Type declarations (.d.ts)
- Clean build process

## Environment Variables

- `NEXT_PUBLIC_LOG_LEVEL`: Minimum log level (default: "info" in production, "debug" in development)
- `NODE_ENV`: Used to determine environment defaults

## Usage Patterns

### Basic Logging
```typescript
import { logger } from '@giga-pdf/logger';

logger.info('Message', { data: 'value' });
logger.error('Error occurred', error);
```

### Custom Logger
```typescript
import { Logger, ConsoleTransport, RemoteTransport } from '@giga-pdf/logger';

const logger = new Logger({
  level: 'info',
  transports: [
    new ConsoleTransport({ pretty: true }),
    new RemoteTransport({ endpoint: '/api/v1/logs' })
  ]
});
```

### React Components
```typescript
import { useLogger } from '@giga-pdf/logger';

function Component({ userId }) {
  const logger = useLogger({
    component: 'Component',
    context: { userId }
  });

  logger.info('Component action');
}
```

### Performance Tracking
```typescript
const stopTimer = logger.startTimer('operation');
// ... do work ...
stopTimer(); // Logs duration

// Or use measure
const result = await logger.measureAsync('operation', async () => {
  return await doWork();
});
```

## API Endpoints

### Remote Transport
- **POST** `/api/v1/logs`
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "logs": [
      {
        "timestamp": "2025-12-18T01:53:00.000Z",
        "level": "error",
        "message": "Error message",
        "context": {
          "requestId": "req-123",
          "userId": "user-456"
        },
        "error": {
          "name": "Error",
          "message": "Something went wrong",
          "stack": "Error: ..."
        }
      }
    ],
    "clientInfo": {
      "userAgent": "...",
      "url": "https://...",
      "timestamp": "2025-12-18T01:53:00.000Z"
    }
  }
  ```

## Build Commands

```bash
# Build the package
pnpm build

# Development mode (watch)
pnpm dev

# Type checking
pnpm type-check

# Linting
pnpm lint

# Clean build artifacts
pnpm clean
```

## Dependencies

### Peer Dependencies
- `react` ^18.0.0 || ^19.0.0 (optional for hooks)

### Dev Dependencies
- `@giga-pdf/typescript-config` - TypeScript configuration
- `@types/react` - React type definitions
- `tsup` - Build tool
- `typescript` - TypeScript compiler

## Integration Points

1. **Frontend Apps** (web, admin): Import and use logger
2. **Backend API**: Receive logs at `/api/v1/logs` endpoint
3. **Canvas Package**: Logger for canvas operations
4. **Editor Package**: Logger for editor actions
5. **UI Package**: Logger for component interactions

## Next Steps

1. Install dependencies: `pnpm install` in the logger package
2. Build the package: `pnpm build`
3. Import in other packages/apps
4. Configure backend endpoint `/api/v1/logs` to receive logs
5. Set environment variables in Next.js apps

## Notes

- All timestamps are ISO 8601 format
- Logs are batched by default to reduce network overhead
- Fatal errors are logged to console even in production
- Remote transport automatically flushes on page unload
- Context is inherited by child loggers
- Performance measurements use browser Performance API
