import type { LogEntry } from '../logger';

/**
 * Color codes for different log levels (browser console)
 */
const LEVEL_COLORS: Record<string, string> = {
  debug: '#6B7280', // gray
  info: '#3B82F6', // blue
  warn: '#F59E0B', // amber
  error: '#EF4444', // red
  fatal: '#DC2626', // dark red
};

/**
 * Log level emojis for visual distinction
 */
const LEVEL_EMOJIS: Record<string, string> = {
  debug: '🔍',
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
  fatal: '💀',
};

/**
 * Pretty formatter for development console output
 * Provides colorized, human-readable log output
 */
export class PrettyFormatter {
  format(entry: LogEntry): {
    message: string;
    styles: string[];
    data?: unknown;
  } {
    const { timestamp, level, message, context, data, error, performance } = entry;

    const emoji = LEVEL_EMOJIS[level] || '';
    const color = LEVEL_COLORS[level] || '#000000';
    const time = new Date(timestamp).toLocaleTimeString();

    // Build formatted message with styling
    let formattedMessage = `%c${emoji} [${level.toUpperCase()}]%c ${time} %c${message}`;
    const styles = [
      `color: ${color}; font-weight: bold;`, // level style
      'color: #9CA3AF;', // time style
      'color: inherit;', // message style
    ];

    // Add context info if present
    if (context && Object.keys(context).length > 0) {
      const contextStr = Object.entries(context)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
      formattedMessage += `%c [${contextStr}]`;
      styles.push('color: #8B5CF6; font-style: italic;'); // purple for context
    }

    // Add performance info if present
    if (performance) {
      formattedMessage += `%c ⏱️ ${performance.duration.toFixed(2)}ms`;
      styles.push('color: #10B981; font-weight: bold;'); // green for performance
    }

    // Return formatted parts
    return {
      message: formattedMessage,
      styles,
      data: data || error,
    };
  }
}
