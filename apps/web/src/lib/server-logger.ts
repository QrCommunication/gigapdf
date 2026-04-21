import "server-only";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context && { context }),
  };

  if (process.env.NODE_ENV === "production") {
    const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
    stream.write(JSON.stringify(entry) + "\n");
  } else {
    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`;
    const body = context ? `${message} ${JSON.stringify(context)}` : message;
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
