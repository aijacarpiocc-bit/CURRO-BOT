type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

function write(level: LogLevel, message: string, error?: unknown): void {
  const timestamp = new Date().toISOString();
  const suffix = error instanceof Error ? ` ${error.stack ?? error.message}` : error ? ` ${String(error)}` : "";
  console.log(`[${timestamp}] [${level}] ${message}${suffix}`);
}

export const logger = {
  info: (message: string) => write("INFO", message),
  warn: (message: string) => write("WARN", message),
  error: (message: string, error?: unknown) => write("ERROR", message, error),
  debug: (message: string) => write("DEBUG", message),
};
