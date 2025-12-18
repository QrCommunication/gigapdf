import type { LogEntry } from '../logger';

/**
 * JSON formatter for structured logging
 * Outputs logs in JSON format suitable for log aggregation systems
 */
export class JsonFormatter {
  format(entry: LogEntry): string {
    try {
      return JSON.stringify(entry);
    } catch (error) {
      // Fallback in case of circular references or other serialization issues
      return JSON.stringify({
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        error: 'Failed to serialize log entry',
      });
    }
  }
}
