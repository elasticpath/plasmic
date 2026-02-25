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

function readConfig(): LogConfig {
  if (cachedConfig) return cachedConfig;

  const defaultConfig: LogConfig = { level: LogLevel.SILENT, modules: "*" };

  if (typeof localStorage === "undefined") {
    cachedConfig = defaultConfig;
    return cachedConfig;
  }

  try {
    const raw = localStorage.getItem("EP_DEBUG");
    if (!raw) {
      cachedConfig = defaultConfig;
      return cachedConfig;
    }

    const trimmed = raw.trim().toLowerCase();

    if (trimmed === "*") {
      cachedConfig = { level: LogLevel.DEBUG, modules: "*" };
      return cachedConfig;
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
      cachedConfig = { level, modules };
      return cachedConfig;
    }

    // Check if the entire value is a level name
    if (trimmed in LEVEL_NAMES) {
      cachedConfig = { level: LEVEL_NAMES[trimmed], modules: "*" };
      return cachedConfig;
    }

    // Otherwise treat as comma-separated module names at DEBUG level
    cachedConfig = {
      level: LogLevel.DEBUG,
      modules: new Set(raw.split(",").map((m) => m.trim())),
    };
    return cachedConfig;
  } catch {
    cachedConfig = defaultConfig;
    return cachedConfig;
  }
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
