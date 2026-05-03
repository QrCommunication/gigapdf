import "server-only";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

// Error.name/message/stack are non-enumerable in ECMAScript, so JSON.stringify
// silently drops them. We must spread them by hand to get useful production logs.
function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const payload: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    const cause = (err as { cause?: unknown }).cause;
    if (cause !== undefined) payload['cause'] = serializeError(cause);
    for (const key of Object.keys(err)) {
      if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') continue;
      payload[key] = (err as unknown as Record<string, unknown>)[key];
    }
    return payload;
  }
  if (err && typeof err === 'object') return err as Record<string, unknown>;
  return { value: String(err) };
}

function normalizeContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const normalized = normalizeContext(context);
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(normalized && { context: normalized }),
  };

  if (process.env.NODE_ENV === "production") {
    const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
    stream.write(JSON.stringify(entry) + "\n");
  } else {
    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`;
    const body = normalized ? `${message} ${JSON.stringify(normalized)}` : message;
    if (level === "error") console.error(prefix, body);
    else if (level === "warn") console.warn(prefix, body);
    else console.log(prefix, body);
  }
}

export const serverLogger = {
  debug: (message: string, context?: Record<string, unknown>) => log("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context),
};
