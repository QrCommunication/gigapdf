import type { LogEntry, Transport } from '../logger';

/**
 * Remote transport options
 */
export interface RemoteTransportOptions {
  /** API endpoint to send logs to */
  endpoint?: string;
  /** Minimum log level to send remotely (default: 'error') */
  level?: string;
  /** Batch size before sending (default: 10) */
  batchSize?: number;
  /** Flush interval in milliseconds (default: 5000) */
  flushInterval?: number;
  /** Custom headers to include in requests */
  headers?: Record<string, string>;
  /** Enable batching (default: true) */
  enableBatching?: boolean;
}

/**
 * Remote transport for sending logs to backend API
 * Supports batching and automatic flushing
 */
export class RemoteTransport implements Transport {
  private options: Required<RemoteTransportOptions>;
  private batch: LogEntry[] = [];
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(options: RemoteTransportOptions = {}) {
    this.options = {
      endpoint: options.endpoint ?? '/api/v1/logs',
      level: options.level ?? 'error',
      batchSize: options.batchSize ?? 10,
      flushInterval: options.flushInterval ?? 5000,
      headers: options.headers ?? {},
      enableBatching: options.enableBatching ?? true,
    };

    // Start flush timer if batching is enabled
    if (this.options.enableBatching) {
      this.startFlushTimer();
    }

    // Flush on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.flush();
      });
    }
  }

  async log(entry: LogEntry): Promise<void> {
    // Check if we should send this level remotely
    if (!this.shouldLog(entry.level)) {
      return;
    }

    if (this.options.enableBatching) {
      this.batch.push(entry);

      // Flush if batch is full
      if (this.batch.length >= this.options.batchSize) {
        await this.flush();
      }
    } else {
      // Send immediately
      await this.send([entry]);
    }
  }

  /**
   * Manually flush the current batch
   */
  async flush(): Promise<void> {
    if (this.batch.length === 0) {
      return;
    }

    const logsToSend = [...this.batch];
    this.batch = [];

    await this.send(logsToSend);
  }

  /**
   * Destroy the transport and cleanup resources
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush().catch((error) => {
      console.error('Failed to flush logs on destroy:', error);
    });
  }

  private async send(entries: LogEntry[]): Promise<void> {
    try {
      const response = await fetch(this.options.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.options.headers,
        },
        body: JSON.stringify({
          logs: entries,
          clientInfo: this.getClientInfo(),
        }),
        // Use keepalive for reliability during page unload
        keepalive: true,
      });

      if (!response.ok) {
        console.error(
          `Failed to send logs to ${this.options.endpoint}: ${response.status} ${response.statusText}`
        );
      }
    } catch (error) {
      console.error('Failed to send logs to remote endpoint:', error);
    }
  }

  private getClientInfo() {
    if (typeof window === 'undefined') {
      return {};
    }

    return {
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: new Date().toISOString(),
    };
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error', 'fatal'];
    const entryLevelIndex = levels.indexOf(level);
    const minLevelIndex = levels.indexOf(this.options.level);

    return entryLevelIndex >= minLevelIndex;
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch((error) => {
        console.error('Failed to flush logs:', error);
      });
    }, this.options.flushInterval);

    // Don't keep Node.js process alive (though this is browser-only)
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }
}
