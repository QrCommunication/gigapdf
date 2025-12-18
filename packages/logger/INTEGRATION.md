# Integration Guide for @giga-pdf/logger

This guide explains how to integrate the logger package into your GigaPDF apps.

## Step 1: Package is Already Available

The logger package is part of the monorepo workspace. After running `pnpm install` at the root, it's automatically available to all apps.

```bash
# From root directory
pnpm install
```

## Step 2: Import in Your App

### Next.js App Configuration

Add environment variable to `apps/web/.env.local`:

```env
# Development
NEXT_PUBLIC_LOG_LEVEL=debug

# Production
# NEXT_PUBLIC_LOG_LEVEL=info
```

### App Layout (apps/web/app/layout.tsx)

```typescript
import { logger } from '@giga-pdf/logger';

export default function RootLayout({ children }) {
  // Initialize logger on app startup
  useEffect(() => {
    logger.info('Application started', {
      version: process.env.NEXT_PUBLIC_APP_VERSION,
      environment: process.env.NODE_ENV,
    });
  }, []);

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### API Route Handler (apps/web/app/api/v1/logs/route.ts)

Create the backend endpoint to receive logs:

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { logs, clientInfo } = body;

    // Process logs (store in database, send to monitoring service, etc.)
    console.log('Received client logs:', {
      count: logs.length,
      clientInfo,
    });

    // Store in database
    // await db.logs.insertMany(logs);

    // Send to monitoring service
    // await monitoring.sendLogs(logs);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to process logs:', error);
    return NextResponse.json(
      { error: 'Failed to process logs' },
      { status: 500 }
    );
  }
}
```

## Step 3: Use in Components

### Page Component

```typescript
// apps/web/app/documents/[id]/page.tsx
import { useLogger } from '@giga-pdf/logger';

export default function DocumentPage({ params }) {
  const logger = useLogger({
    component: 'DocumentPage',
    context: { documentId: params.id },
  });

  useEffect(() => {
    logger.info('Document page loaded');
  }, [logger]);

  return <div>Document content</div>;
}
```

### Custom Component

```typescript
// apps/web/components/document-editor.tsx
import { useLogger, usePerformanceTracking } from '@giga-pdf/logger';

export function DocumentEditor({ documentId }) {
  const logger = useLogger({
    component: 'DocumentEditor',
    context: { documentId },
  });

  usePerformanceTracking('DocumentEditor:render');

  const handleSave = async () => {
    logger.info('Saving document');

    try {
      await logger.measureAsync('saveDocument', async () => {
        await saveDocument(documentId);
      });

      logger.info('Document saved successfully');
    } catch (error) {
      logger.error('Failed to save document', error);
    }
  };

  return <button onClick={handleSave}>Save</button>;
}
```

## Step 4: Create App-Specific Logger

### Create logger instance (apps/web/lib/logger.ts)

```typescript
import { createDefaultLogger } from '@giga-pdf/logger';

export const webLogger = createDefaultLogger({
  enableRemote: process.env.NODE_ENV === 'production',
  remoteEndpoint: '/api/v1/logs',
  pretty: process.env.NODE_ENV === 'development',
});

// Module-specific loggers
export const authLogger = webLogger.child({ module: 'auth' });
export const apiLogger = webLogger.child({ module: 'api' });
export const editorLogger = webLogger.child({ module: 'editor' });
```

### Use in API Client

```typescript
// apps/web/lib/api-client.ts
import { apiLogger } from './logger';

export class APIClient {
  async request(method: string, path: string, data?: unknown) {
    const requestId = crypto.randomUUID();
    apiLogger.setContext({ requestId });

    apiLogger.debug('API request', { method, path });

    try {
      const result = await apiLogger.measureAsync('api-request', async () => {
        const response = await fetch(`/api${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: data ? JSON.stringify(data) : undefined,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
      });

      apiLogger.info('API request completed', { method, path });
      return result;
    } catch (error) {
      apiLogger.error('API request failed', error, { method, path });
      throw error;
    } finally {
      apiLogger.clearContext('requestId');
    }
  }
}
```

## Step 5: Add to Package Dependencies

The logger is already in the workspace, but you need to add it to your app's package.json:

```json
// apps/web/package.json
{
  "dependencies": {
    "@giga-pdf/logger": "workspace:*"
  }
}
```

Then run:

```bash
pnpm install
```

## Step 6: Configure for Different Environments

### Development
- Log level: `debug`
- Pretty console output
- No remote logging

### Production
- Log level: `info`
- JSON console output
- Remote logging for errors

### Environment-specific configuration

```typescript
// apps/web/lib/logger.ts
import {
  Logger,
  ConsoleTransport,
  RemoteTransport,
} from '@giga-pdf/logger';

const isDev = process.env.NODE_ENV === 'development';

export const logger = new Logger({
  level: isDev ? 'debug' : 'info',
});

// Console transport
logger.addTransport(
  new ConsoleTransport({
    pretty: isDev,
    level: 'debug',
  })
);

// Remote transport (production only)
if (!isDev) {
  logger.addTransport(
    new RemoteTransport({
      endpoint: '/api/v1/logs',
      level: 'error', // Only send errors remotely
      batchSize: 10,
      flushInterval: 5000,
    })
  );
}
```

## Step 7: Add Error Boundary Logging

```typescript
// apps/web/components/error-boundary.tsx
'use client';

import { Component, ReactNode } from 'react';
import { logger } from '@giga-pdf/logger';

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: unknown) {
    logger.fatal('React error boundary caught error', error, {
      errorInfo,
      component: 'ErrorBoundary',
    });
  }

  render() {
    if (this.state.hasError) {
      return <div>Something went wrong</div>;
    }

    return this.props.children;
  }
}
```

## Step 8: Add Global Error Handler

```typescript
// apps/web/app/layout.tsx
'use client';

import { logger } from '@giga-pdf/logger';
import { useEffect } from 'react';

export default function RootLayout({ children }) {
  useEffect(() => {
    // Global error handler
    const handleError = (event: ErrorEvent) => {
      logger.error('Unhandled error', event.error, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };

    // Unhandled promise rejection
    const handleRejection = (event: PromiseRejectionEvent) => {
      logger.error('Unhandled promise rejection', event.reason);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

## Step 9: Testing

### Test the logger works

```typescript
// apps/web/app/test-logger/page.tsx
'use client';

import { logger } from '@giga-pdf/logger';

export default function TestLoggerPage() {
  const testLogs = () => {
    logger.debug('Debug message', { test: true });
    logger.info('Info message', { test: true });
    logger.warn('Warning message', { test: true });
    logger.error('Error message', new Error('Test error'));
  };

  return (
    <div>
      <button onClick={testLogs}>Test Logs</button>
    </div>
  );
}
```

## Step 10: Monitor Logs

### Development
- Open browser console
- See colorized, pretty-printed logs
- Use browser console filters

### Production
- Logs are sent to `/api/v1/logs`
- Store in database or send to monitoring service
- Set up alerts for errors

## Backend Integration

### Database Schema (Example with Prisma)

```prisma
// schema.prisma
model Log {
  id        String   @id @default(cuid())
  timestamp DateTime
  level     String
  message   String
  context   Json?
  data      Json?
  error     Json?
  clientInfo Json?
  createdAt DateTime @default(now())

  @@index([level])
  @@index([timestamp])
}
```

### API Endpoint Implementation

```typescript
// apps/web/app/api/v1/logs/route.ts
import { db } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { logs, clientInfo } = await request.json();

    // Store logs in database
    await db.log.createMany({
      data: logs.map((log) => ({
        timestamp: new Date(log.timestamp),
        level: log.level,
        message: log.message,
        context: log.context,
        data: log.data,
        error: log.error,
        clientInfo,
      })),
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
    });
  } catch (error) {
    console.error('Failed to store logs:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to store logs' }),
      { status: 500 }
    );
  }
}
```

## Troubleshooting

### Logs not appearing
1. Check `NEXT_PUBLIC_LOG_LEVEL` environment variable
2. Verify log level meets the threshold
3. Check browser console filters
4. Ensure logger is imported and initialized

### Remote logging not working
1. Verify `/api/v1/logs` endpoint exists
2. Check network tab for failed requests
3. Ensure log level is 'error' or higher
4. Check backend endpoint implementation

### TypeScript errors
1. Ensure `@giga-pdf/logger` is in dependencies
2. Run `pnpm install`
3. Restart TypeScript server
4. Check tsconfig.json includes DOM types

## Best Practices

1. Use app-specific logger instances
2. Create module-specific child loggers
3. Add context to all logs
4. Log errors with full context
5. Measure critical operations
6. Use appropriate log levels
7. Don't log sensitive data
8. Monitor production logs

## Next Steps

1. Add logger to your app's package.json
2. Create app-specific logger configuration
3. Implement `/api/v1/logs` endpoint
4. Add logging throughout your app
5. Set up log monitoring/alerts
6. Configure production logging
