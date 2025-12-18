import type { LogContext } from './context';
import { ContextManager } from './context';

/**
 * Log levels supported by the logger
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Performance timing information
 */
export interface PerformanceInfo {
  /** Operation name */
  operation: string;
  /** Duration in milliseconds */
  duration: number;
  /** Start timestamp */
  startTime: number;
  /** End timestamp */
  endTime: number;
}

/**
 * Serialized error information
 */
export interface SerializedError {
  /** Error name */
  name: string;
  /** Error message */
  message: string;
  /** Stack trace */
  stack?: string;
  /** Error code if available */
  code?: string;
  /** Additional error properties */
  [key: string]: unknown;
}

/**
 * Complete log entry structure
 */
export interface LogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Contextual information */
  context?: LogContext;
  /** Additional structured data */
  data?: Record<string, unknown>;
  /** Serialized error if present */
  error?: SerializedError;
  /** Performance information if present */
  performance?: PerformanceInfo;
}

/**
 * Transport interface for log output
 */
export interface Transport {
  log(entry: LogEntry): Promise<void> | void;
}

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /** Minimum log level */
  level?: LogLevel;
  /** Transports to use */
  transports?: Transport[];
  /** Default context */
  defaultContext?: LogContext;
}

/**
 * Main Logger class for structured logging
 */
export class Logger {
  private level: LogLevel;
  private transports: Transport[];
  private contextManager: ContextManager;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? this.getDefaultLevel();
    this.transports = options.transports ?? [];
    this.contextManager = new ContextManager();

    if (options.defaultContext) {
      this.contextManager.setContext(options.defaultContext);
    }
  }

  /**
   * Set logging context
   */
  setContext(context: LogContext): void {
    this.contextManager.setContext(context);
  }

  /**
   * Get current context
   */
  getContext(): LogContext {
    return this.contextManager.getContext();
  }

  /**
   * Clear context field
   */
  clearContext(key: keyof LogContext): void {
    this.contextManager.clearField(key);
  }

  /**
   * Clear all context
   */
  clearAllContext(): void {
    this.contextManager.clearAll();
  }

  /**
   * Add a transport
   */
  addTransport(transport: Transport): void {
    this.transports.push(transport);
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  /**
   * Log an info message
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    const entry = this.createEntry('error', message, data);

    if (error) {
      entry.error = this.serializeError(error);
    }

    this.write(entry);
  }

  /**
   * Log a fatal error message
   */
  fatal(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    const entry = this.createEntry('fatal', message, data);

    if (error) {
      entry.error = this.serializeError(error);
    }

    this.write(entry);
  }

  /**
   * Create a performance timer
   */
  startTimer(operation: string): () => void {
    const startTime = performance.now();

    return () => {
      const endTime = performance.now();
      const duration = endTime - startTime;

      this.logPerformance({
        operation,
        duration,
        startTime,
        endTime,
      });
    };
  }

  /**
   * Measure and log an async operation's performance
   */
  async measureAsync<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const stopTimer = this.startTimer(operation);

    try {
      const result = await fn();
      stopTimer();
      return result;
    } catch (error) {
      stopTimer();
      this.error(`${operation} failed`, error);
      throw error;
    }
  }

  /**
   * Measure and log a sync operation's performance
   */
  measure<T>(operation: string, fn: () => T): T {
    const stopTimer = this.startTimer(operation);

    try {
      const result = fn();
      stopTimer();
      return result;
    } catch (error) {
      stopTimer();
      this.error(`${operation} failed`, error);
      throw error;
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger({
      level: this.level,
      transports: this.transports,
      defaultContext: this.contextManager.withContext(context),
    });

    return childLogger;
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry = this.createEntry(level, message, data);
    this.write(entry);
  }

  private logPerformance(performance: PerformanceInfo): void {
    const entry = this.createEntry('info', `Performance: ${performance.operation}`);
    entry.performance = performance;
    this.write(entry);
  }

  private createEntry(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    const context = this.contextManager.getContext();
    if (Object.keys(context).length > 0) {
      entry.context = context;
    }

    if (data && Object.keys(data).length > 0) {
      entry.data = data;
    }

    return entry;
  }

  private write(entry: LogEntry): void {
    // Send to all transports
    for (const transport of this.transports) {
      try {
        const result = transport.log(entry);
        // Handle async transports
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error('Transport error:', error);
          });
        }
      } catch (error) {
        console.error('Transport error:', error);
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
    const entryLevelIndex = levels.indexOf(level);
    const minLevelIndex = levels.indexOf(this.level);

    return entryLevelIndex >= minLevelIndex;
  }

  private serializeError(error: unknown): SerializedError {
    if (error instanceof Error) {
      const serialized: SerializedError = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };

      // Include additional enumerable properties
      for (const key of Object.keys(error)) {
        if (key !== 'name' && key !== 'message' && key !== 'stack') {
          serialized[key] = (error as unknown as Record<string, unknown>)[key];
        }
      }

      return serialized;
    }

    // For non-Error objects
    return {
      name: 'Unknown',
      message: String(error),
    };
  }

  private getDefaultLevel(): LogLevel {
    if (typeof process !== 'undefined' && process.env) {
      const envLevel = process.env.NEXT_PUBLIC_LOG_LEVEL;
      if (envLevel && this.isValidLevel(envLevel)) {
        return envLevel as LogLevel;
      }

      // Default based on NODE_ENV
      const nodeEnv = process.env.NODE_ENV;
      return nodeEnv === 'production' ? 'info' : 'debug';
    }

    // Browser environment without process.env
    return 'info';
  }

  private isValidLevel(level: string): boolean {
    return ['debug', 'info', 'warn', 'error', 'fatal'].includes(level);
  }
}
