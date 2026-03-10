/**
 * @giga-pdf/logger
 *
 * Structured logging package for GigaPDF frontend applications
 * Provides comprehensive logging with support for:
 * - Multiple log levels (debug, info, warn, error, fatal)
 * - Structured JSON logging for production
 * - Pretty console output for development
 * - Remote log transport to backend API
 * - Contextual logging (requestId, userId, documentId)
 * - Performance tracking utilities
 * - React hooks for component logging
 * - Error serialization with stack traces
 */

// Core logger
export { Logger, type LoggerOptions, type LogLevel, type LogEntry } from './logger';

// Context management
export { ContextManager, type LogContext } from './context';

// Transports
export {
  ConsoleTransport,
  RemoteTransport,
  type ConsoleTransportOptions,
  type RemoteTransportOptions,
} from './transports';

// Formatters
export { JsonFormatter, PrettyFormatter } from './formatters';

// React hooks
export {
  useLogger,
  usePerformanceTracking,
  useComponentLifecycle,
  type UseLoggerOptions,
} from './hooks';

// Default logger instance factory
import { Logger } from './logger';
import { ConsoleTransport } from './transports/console';
import { RemoteTransport } from './transports/remote';

/**
 * Create a default logger instance with standard configuration
 *
 * @example
 * ```ts
 * import { createDefaultLogger } from '@giga-pdf/logger';
 *
 * const logger = createDefaultLogger();
 * logger.info('Application started');
 * ```
 */
export function createDefaultLogger(options: {
  enableRemote?: boolean;
  remoteEndpoint?: string;
  pretty?: boolean;
} = {}): Logger {
  const isDevelopment =
    typeof process !== 'undefined' &&
    process.env &&
    process.env.NODE_ENV === 'development';

  const logger = new Logger({
    level: isDevelopment ? 'debug' : 'info',
  });

  // Add console transport
  logger.addTransport(
    new ConsoleTransport({
      pretty: options.pretty ?? isDevelopment,
    })
  );

  // Add remote transport if enabled (default in production)
  if (options.enableRemote ?? !isDevelopment) {
    logger.addTransport(
      new RemoteTransport({
        endpoint: options.remoteEndpoint ?? '/api/v1/logs',
        level: 'error', // Only send errors remotely by default
      })
    );
  }

  return logger;
}

/**
 * Global logger instance for convenience
 * Use this for simple logging needs, or create your own logger instance
 *
 * @example
 * ```ts
 * import { logger } from '@giga-pdf/logger';
 *
 * logger.info('Hello world');
 * logger.error('Something went wrong', error);
 * ```
 */
export const logger = createDefaultLogger();
