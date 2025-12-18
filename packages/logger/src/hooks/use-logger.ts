import { useEffect, useMemo, useRef } from 'react';
import { Logger, type LoggerOptions } from '../logger';
import type { LogContext } from '../context';

/**
 * Hook options for useLogger
 */
export interface UseLoggerOptions extends LoggerOptions {
  /** Component-specific context to add */
  context?: LogContext;
  /** Component name for logging */
  component?: string;
}

/**
 * React hook for using the logger with component context
 *
 * @example
 * ```tsx
 * function MyComponent({ userId }) {
 *   const logger = useLogger({
 *     component: 'MyComponent',
 *     context: { userId }
 *   });
 *
 *   useEffect(() => {
 *     logger.info('Component mounted');
 *     return () => logger.info('Component unmounted');
 *   }, [logger]);
 *
 *   const handleClick = () => {
 *     logger.debug('Button clicked');
 *   };
 *
 *   return <button onClick={handleClick}>Click me</button>;
 * }
 * ```
 */
export function useLogger(options: UseLoggerOptions = {}): Logger {
  // Create logger instance only once
  const loggerRef = useRef<Logger>();

  if (!loggerRef.current) {
    loggerRef.current = new Logger(options);
  }

  const logger = loggerRef.current;

  // Build context from component name and custom context
  const context = useMemo(() => {
    const ctx: LogContext = {};

    if (options.component) {
      ctx.component = options.component;
    }

    if (options.context) {
      Object.assign(ctx, options.context);
    }

    return ctx;
  }, [options.component, options.context]);

  // Update context when it changes
  useEffect(() => {
    if (Object.keys(context).length > 0) {
      logger.setContext(context);
    }
  }, [logger, context]);

  return logger;
}

/**
 * Hook for performance tracking
 *
 * @example
 * ```tsx
 * function ExpensiveComponent() {
 *   usePerformanceTracking('ExpensiveComponent:render');
 *
 *   // Component will log render time on each render
 *   return <div>...</div>;
 * }
 * ```
 */
export function usePerformanceTracking(operation: string, logger?: Logger): void {
  const startTimeRef = useRef<number>();
  const loggerInstance = logger || new Logger();

  useEffect(() => {
    // Record start time on mount or update
    startTimeRef.current = performance.now();

    return () => {
      // Log performance on unmount
      if (startTimeRef.current !== undefined) {
        const duration = performance.now() - startTimeRef.current;
        loggerInstance.info(`Performance: ${operation}`, {
          duration,
          operation,
        });
      }
    };
  });
}

/**
 * Hook for logging component lifecycle events
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   useComponentLifecycle('MyComponent');
 *
 *   // Logs mount and unmount events
 *   return <div>...</div>;
 * }
 * ```
 */
export function useComponentLifecycle(componentName: string, logger?: Logger): void {
  const loggerInstance = logger || new Logger();

  useEffect(() => {
    loggerInstance.debug(`${componentName} mounted`);

    return () => {
      loggerInstance.debug(`${componentName} unmounted`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
