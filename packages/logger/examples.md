# @giga-pdf/logger Examples

## Example 1: Basic Application Logging

```typescript
import { logger } from '@giga-pdf/logger';

// Application startup
logger.info('Application starting', {
  version: '1.0.0',
  environment: process.env.NODE_ENV,
});

// User authentication
logger.info('User logged in', {
  userId: 'user-123',
  email: 'user@example.com',
});

// Error handling
try {
  await processDocument();
} catch (error) {
  logger.error('Failed to process document', error, {
    documentId: 'doc-456',
    operation: 'process',
  });
}
```

## Example 2: Custom Logger with Multiple Transports

```typescript
import {
  Logger,
  ConsoleTransport,
  RemoteTransport,
} from '@giga-pdf/logger';

const logger = new Logger({
  level: 'debug',
});

// Add pretty console for development
logger.addTransport(
  new ConsoleTransport({
    pretty: true,
    level: 'debug',
  })
);

// Add remote transport for errors
logger.addTransport(
  new RemoteTransport({
    endpoint: '/api/v1/logs',
    level: 'error',
    batchSize: 5,
    flushInterval: 3000,
    headers: {
      'X-App-Version': '1.0.0',
    },
  })
);

logger.info('Logger initialized');
```

## Example 3: Request Tracing with Context

```typescript
import { createDefaultLogger } from '@giga-pdf/logger';

const logger = createDefaultLogger();

// API request handler
async function handleRequest(req: Request) {
  const requestId = generateRequestId();

  // Set context for this request
  logger.setContext({
    requestId,
    userId: req.userId,
    path: req.path,
  });

  logger.info('Request received');

  try {
    const result = await processRequest(req);
    logger.info('Request completed successfully');
    return result;
  } catch (error) {
    logger.error('Request failed', error);
    throw error;
  } finally {
    // Clear context after request
    logger.clearAllContext();
  }
}
```

## Example 4: React Component Logging

```typescript
import { useLogger, usePerformanceTracking } from '@giga-pdf/logger';
import { useEffect, useState } from 'react';

function DocumentEditor({ documentId, userId }) {
  const logger = useLogger({
    component: 'DocumentEditor',
    context: { documentId, userId },
  });

  const [document, setDocument] = useState(null);

  // Track component render performance
  usePerformanceTracking('DocumentEditor:render');

  useEffect(() => {
    logger.info('Loading document');

    const loadDocument = async () => {
      try {
        const stopTimer = logger.startTimer('loadDocument');
        const doc = await fetchDocument(documentId);
        stopTimer();

        setDocument(doc);
        logger.info('Document loaded successfully');
      } catch (error) {
        logger.error('Failed to load document', error);
      }
    };

    loadDocument();
  }, [documentId, logger]);

  const handleSave = async () => {
    logger.info('Saving document');

    try {
      await logger.measureAsync('saveDocument', async () => {
        await saveDocument(document);
      });

      logger.info('Document saved successfully');
    } catch (error) {
      logger.error('Failed to save document', error);
    }
  };

  return (
    <div>
      <button onClick={handleSave}>Save</button>
      {/* ... */}
    </div>
  );
}
```

## Example 5: Performance Tracking

```typescript
import { logger } from '@giga-pdf/logger';

// Using timer manually
function processData(data: unknown[]) {
  const stopTimer = logger.startTimer('processData');

  // Process data...
  const result = data.map(transform);

  stopTimer(); // Logs performance info

  return result;
}

// Using measureAsync
async function fetchUserData(userId: string) {
  return await logger.measureAsync('fetchUserData', async () => {
    const response = await fetch(`/api/users/${userId}`);
    return response.json();
  });
}

// Using measure for sync operations
function calculateTotals(items: Item[]) {
  return logger.measure('calculateTotals', () => {
    return items.reduce((sum, item) => sum + item.price, 0);
  });
}
```

## Example 6: Child Loggers for Modules

```typescript
import { createDefaultLogger } from '@giga-pdf/logger';

// Main application logger
const appLogger = createDefaultLogger();

// Create module-specific loggers
export const authLogger = appLogger.child({ module: 'auth' });
export const apiLogger = appLogger.child({ module: 'api' });
export const wsLogger = appLogger.child({ module: 'websocket' });

// Usage in auth module
authLogger.info('User login attempt', { email: 'user@example.com' });
// Logs: { module: 'auth', message: 'User login attempt', ... }

// Usage in API module
apiLogger.debug('Making API request', { endpoint: '/users' });
// Logs: { module: 'api', message: 'Making API request', ... }
```

## Example 7: Error Handling with Stack Traces

```typescript
import { logger } from '@giga-pdf/logger';

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

async function validateAndSave(data: unknown) {
  try {
    validateData(data);
    await saveData(data);
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn('Validation failed', error, {
        field: error.field,
        code: error.code,
      });
    } else {
      logger.error('Unexpected error during save', error);
    }
    throw error;
  }
}
```

## Example 8: WebSocket Connection Logging

```typescript
import { logger } from '@giga-pdf/logger';

class WebSocketManager {
  private logger = logger.child({ module: 'websocket' });

  connect(url: string) {
    this.logger.info('Connecting to WebSocket', { url });

    const ws = new WebSocket(url);

    ws.onopen = () => {
      this.logger.info('WebSocket connected');
    };

    ws.onmessage = (event) => {
      this.logger.debug('Message received', {
        messageType: event.type,
        dataSize: event.data.length,
      });
    };

    ws.onerror = (error) => {
      this.logger.error('WebSocket error', error);
    };

    ws.onclose = (event) => {
      this.logger.info('WebSocket closed', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
    };

    return ws;
  }
}
```

## Example 9: Document Processing Pipeline

```typescript
import { logger } from '@giga-pdf/logger';

async function processPDFDocument(documentId: string, userId: string) {
  const docLogger = logger.child({ documentId, userId });

  docLogger.info('Starting PDF processing pipeline');

  try {
    // Step 1: Download
    const pdf = await docLogger.measureAsync('downloadPDF', async () => {
      docLogger.debug('Downloading PDF from storage');
      return await downloadPDF(documentId);
    });

    // Step 2: Parse
    const parsed = await docLogger.measureAsync('parsePDF', async () => {
      docLogger.debug('Parsing PDF content');
      return await parsePDF(pdf);
    });

    // Step 3: Extract metadata
    const metadata = docLogger.measure('extractMetadata', () => {
      docLogger.debug('Extracting metadata');
      return extractMetadata(parsed);
    });

    // Step 4: Generate thumbnails
    await docLogger.measureAsync('generateThumbnails', async () => {
      docLogger.debug('Generating thumbnails', {
        pageCount: parsed.pages.length,
      });
      return await generateThumbnails(parsed);
    });

    docLogger.info('PDF processing completed successfully', {
      pageCount: parsed.pages.length,
      fileSize: pdf.size,
    });

    return { parsed, metadata };
  } catch (error) {
    docLogger.error('PDF processing failed', error);
    throw error;
  }
}
```

## Example 10: API Client with Logging

```typescript
import { logger } from '@giga-pdf/logger';

class APIClient {
  private logger = logger.child({ module: 'api-client' });
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.logger.info('API client initialized', { baseURL });
  }

  async request<T>(
    method: string,
    path: string,
    data?: unknown
  ): Promise<T> {
    const requestId = crypto.randomUUID();

    this.logger.setContext({ requestId });
    this.logger.debug('API request started', { method, path });

    const stopTimer = this.logger.startTimer(`api:${method}:${path}`);

    try {
      const response = await fetch(`${this.baseURL}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
        },
        body: data ? JSON.stringify(data) : undefined,
      });

      stopTimer();

      if (!response.ok) {
        this.logger.warn('API request failed', {
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      this.logger.info('API request completed', {
        method,
        path,
        status: response.status,
      });

      return result;
    } catch (error) {
      stopTimer();
      this.logger.error('API request error', error, { method, path });
      throw error;
    } finally {
      this.logger.clearContext('requestId');
    }
  }
}

// Usage
const api = new APIClient('https://api.example.com');

await api.request('GET', '/users/123');
await api.request('POST', '/documents', { title: 'New Doc' });
```
