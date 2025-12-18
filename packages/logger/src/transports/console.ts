import type { LogEntry, Transport } from '../logger';
import { PrettyFormatter } from '../formatters/pretty';
import { JsonFormatter } from '../formatters/json';

/**
 * Console transport options
 */
export interface ConsoleTransportOptions {
  /** Use pretty formatting for development (default: true) */
  pretty?: boolean;
  /** Minimum log level to output */
  level?: string;
}

/**
 * Console transport for browser console output
 * Supports both pretty (development) and JSON (production) formatting
 */
export class ConsoleTransport implements Transport {
  private prettyFormatter = new PrettyFormatter();
  private jsonFormatter = new JsonFormatter();
  private options: Required<ConsoleTransportOptions>;

  constructor(options: ConsoleTransportOptions = {}) {
    this.options = {
      pretty: options.pretty ?? true,
      level: options.level ?? 'debug',
    };
  }

  async log(entry: LogEntry): Promise<void> {
    // Check if we should log this level
    if (!this.shouldLog(entry.level)) {
      return;
    }

    if (this.options.pretty) {
      this.logPretty(entry);
    } else {
      this.logJson(entry);
    }
  }

  private logPretty(entry: LogEntry): void {
    const { message, styles, data } = this.prettyFormatter.format(entry);
    const consoleMethod = this.getConsoleMethod(entry.level);

    // Log the formatted message
    consoleMethod(message, ...styles);

    // Log additional data if present
    if (data) {
      console.log(data);
    }
  }

  private logJson(entry: LogEntry): void {
    const formatted = this.jsonFormatter.format(entry);
    const consoleMethod = this.getConsoleMethod(entry.level);
    consoleMethod(formatted);
  }

  private getConsoleMethod(level: string): typeof console.log {
    switch (level) {
      case 'debug':
        return console.debug.bind(console);
      case 'info':
        return console.info.bind(console);
      case 'warn':
        return console.warn.bind(console);
      case 'error':
      case 'fatal':
        return console.error.bind(console);
      default:
        return console.log.bind(console);
    }
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error', 'fatal'];
    const entryLevelIndex = levels.indexOf(level);
    const minLevelIndex = levels.indexOf(this.options.level);

    return entryLevelIndex >= minLevelIndex;
  }
}
