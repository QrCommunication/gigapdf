/**
 * Logging context for request tracing and correlation
 */
export interface LogContext {
  /** Unique request identifier for tracing requests across services */
  requestId?: string;
  /** User identifier for user-specific logging */
  userId?: string;
  /** Document identifier for document-specific operations */
  documentId?: string;
  /** Additional custom context fields */
  [key: string]: unknown;
}

/**
 * Context manager for maintaining logging context
 */
export class ContextManager {
  private context: LogContext = {};

  /**
   * Set context fields
   */
  setContext(ctx: LogContext): void {
    this.context = { ...this.context, ...ctx };
  }

  /**
   * Get current context
   */
  getContext(): LogContext {
    return { ...this.context };
  }

  /**
   * Clear specific context field
   */
  clearField(key: keyof LogContext): void {
    delete this.context[key];
  }

  /**
   * Clear all context
   */
  clearAll(): void {
    this.context = {};
  }

  /**
   * Create a new context with merged values
   */
  withContext(additionalContext: LogContext): LogContext {
    return { ...this.context, ...additionalContext };
  }
}
