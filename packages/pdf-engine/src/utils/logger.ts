/**
 * Logger structuré minimaliste pour @giga-pdf/pdf-engine.
 * Produit des entrées JSON en production et des messages lisibles en développement.
 * Pas de dépendance externe — le package est un module Node.js pur.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

function isDevelopment(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.env['NODE_ENV'] !== 'production'
  );
}

function formatEntry(entry: LogEntry): string {
  if (isDevelopment()) {
    const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    return `[pdf-engine][${entry.level.toUpperCase()}] ${entry.message}${ctx}`;
  }
  return JSON.stringify(entry);
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    message,
    ...(context ? { context } : {}),
    timestamp: new Date().toISOString(),
  };

  const formatted = formatEntry(entry);

  if (level === 'error') {
    process.stderr.write(formatted + '\n');
  } else if (level === 'warn') {
    process.stderr.write(formatted + '\n');
  } else {
    process.stdout.write(formatted + '\n');
  }
}

export const engineLogger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
