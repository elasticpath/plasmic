/**
 * Structured debug logging for EP Plasmic components.
 *
 * Enable via browser console:
 *   localStorage.setItem("EP_DEBUG", "*")           // all modules, DEBUG level
 *   localStorage.setItem("EP_DEBUG", "EPStock")     // specific module(s), DEBUG level
 *   localStorage.setItem("EP_DEBUG", "warn")        // all modules, WARN+ only
 *   localStorage.setItem("EP_DEBUG", "warn:EPStock") // specific modules, WARN+ only
 *
 * Then reload the page. Call resetLogConfig() after changing the value
 * without a reload.
 *
 * On the server, set the EP_DEBUG environment variable with the same values.
 * Unset, the server logs warnings and errors.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

interface LogConfig {
  level: LogLevel;
  modules: Set<string> | "*";
}

const LEVEL_NAMES: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
  silent: LogLevel.SILENT,
};

let cachedConfig: LogConfig | null = null;

function parseConfig(raw: string): LogConfig {
  const trimmed = raw.trim().toLowerCase();

  if (trimmed === "*") {
    return { level: LogLevel.DEBUG, modules: "*" };
  }

  // Check for "level:modules" format
  const colonIndex = raw.indexOf(":");
  if (colonIndex > 0) {
    const levelStr = raw.slice(0, colonIndex).trim().toLowerCase();
    const modulesStr = raw.slice(colonIndex + 1).trim();
    const level = LEVEL_NAMES[levelStr] ?? LogLevel.DEBUG;
    const modules =
      modulesStr === "*"
        ? ("*" as const)
        : new Set(modulesStr.split(",").map((m) => m.trim()));
    return { level, modules };
  }

  // Check if the entire value is a level name
  if (trimmed in LEVEL_NAMES) {
    return { level: LEVEL_NAMES[trimmed], modules: "*" };
  }

  // Otherwise treat as comma-separated module names at DEBUG level
  return {
    level: LogLevel.DEBUG,
    modules: new Set(raw.split(",").map((m) => m.trim())),
  };
}

function readConfig(): LogConfig {
  if (cachedConfig) return cachedConfig;

  // On the server a failure must reach the host's logs, so warnings and
  // errors are on by default there; the browser console stays quiet.
  if (typeof localStorage === "undefined") {
    const raw = typeof process !== "undefined" ? process.env?.EP_DEBUG : undefined;
    cachedConfig = raw ? parseConfig(raw) : { level: LogLevel.WARN, modules: "*" };
    return cachedConfig;
  }

  const defaultConfig: LogConfig = { level: LogLevel.SILENT, modules: "*" };
  try {
    const raw = localStorage.getItem("EP_DEBUG");
    cachedConfig = raw ? parseConfig(raw) : defaultConfig;
  } catch {
    cachedConfig = defaultConfig;
  }
  return cachedConfig;
}

export function resetLogConfig(): void {
  cachedConfig = null;
}

const CONSOLE_METHODS = {
  [LogLevel.DEBUG]: "debug",
  [LogLevel.INFO]: "info",
  [LogLevel.WARN]: "warn",
  [LogLevel.ERROR]: "error",
} as const;

class EPLogger {
  private tag: string;

  constructor(private module: string) {
    this.tag = `[EP:${module}]`;
  }

  private emit(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
    const config = readConfig();
    if (level < config.level) return;
    if (
      config.modules !== "*" &&
      !config.modules.has(this.module)
    ) {
      return;
    }

    const method =
      CONSOLE_METHODS[level as keyof typeof CONSOLE_METHODS] || "log";
    if (data !== undefined) {
      console[method](`${this.tag} ${message}`, data);
    } else {
      console[method](`${this.tag} ${message}`);
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.emit(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.emit(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.emit(LogLevel.WARN, message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.emit(LogLevel.ERROR, message, data);
  }
}

export function createLogger(module: string): EPLogger {
  return new EPLogger(module);
}
