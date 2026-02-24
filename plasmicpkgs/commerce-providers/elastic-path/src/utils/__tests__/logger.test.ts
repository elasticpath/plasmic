/**
 * Tests for the EP structured debug logger.
 *
 * Because esbuild jest transform hoists imports, we use `require("../logger")`
 * inside tests so that localStorage mocks are in place before the module loads.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

const mockGetItem = jest.fn();

Object.defineProperty(global, "localStorage", {
  value: {
    getItem: mockGetItem,
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
  writable: true,
});

let debugSpy: jest.SpyInstance;
let infoSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  // Clear cached config between every test
  const { resetLogConfig } = require("../logger");
  resetLogConfig();

  mockGetItem.mockReset();

  debugSpy = jest.spyOn(console, "debug").mockImplementation();
  infoSpy = jest.spyOn(console, "info").mockImplementation();
  warnSpy = jest.spyOn(console, "warn").mockImplementation();
  errorSpy = jest.spyOn(console, "error").mockImplementation();
});

afterEach(() => {
  debugSpy.mockRestore();
  infoSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLogger(module: string) {
  const { createLogger } = require("../logger");
  return createLogger(module);
}

function resetConfig() {
  const { resetLogConfig } = require("../logger");
  resetLogConfig();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("logger", () => {
  // -----------------------------------------------------------------------
  // Default / silent behaviour
  // -----------------------------------------------------------------------
  describe("default silent behaviour (no EP_DEBUG value)", () => {
    it("should not log anything when localStorage returns null", () => {
      mockGetItem.mockReturnValue(null);
      const log = getLogger("EPProduct");

      log.debug("hello");
      log.info("hello");
      log.warn("hello");
      log.error("hello");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("should not log anything when localStorage returns empty string", () => {
      mockGetItem.mockReturnValue("");
      const log = getLogger("EPCart");

      log.debug("test");
      log.info("test");
      log.warn("test");
      log.error("test");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // SSR / localStorage undefined
  // -----------------------------------------------------------------------
  describe("SSR fallback (localStorage undefined)", () => {
    it("should fall back to silent when localStorage is undefined", () => {
      const original = global.localStorage;
      // Temporarily remove localStorage to simulate SSR
      Object.defineProperty(global, "localStorage", {
        value: undefined,
        writable: true,
      });

      resetConfig();
      const log = getLogger("EPProduct");

      log.debug("should not appear");
      log.info("should not appear");
      log.warn("should not appear");
      log.error("should not appear");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      // Restore for subsequent tests
      Object.defineProperty(global, "localStorage", {
        value: original,
        writable: true,
      });
    });
  });

  // -----------------------------------------------------------------------
  // Wildcard "*" config
  // -----------------------------------------------------------------------
  describe('"*" enables all modules at DEBUG', () => {
    it("should log debug messages from any module", () => {
      mockGetItem.mockReturnValue("*");
      const log = getLogger("EPAnything");

      log.debug("visible");

      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy).toHaveBeenCalledWith("[EP:EPAnything] visible");
    });

    it("should log all levels when set to *", () => {
      mockGetItem.mockReturnValue("*");
      const log = getLogger("EPStock");

      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");

      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Level-only config (e.g. "warn")
  // -----------------------------------------------------------------------
  describe("level-only config", () => {
    it("should log warn and error when level is warn", () => {
      mockGetItem.mockReturnValue("warn");
      const log = getLogger("EPCart");

      log.debug("no");
      log.info("no");
      log.warn("yes");
      log.error("yes");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("should log only errors when level is error", () => {
      mockGetItem.mockReturnValue("error");
      const log = getLogger("EPProduct");

      log.debug("no");
      log.info("no");
      log.warn("no");
      log.error("yes");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("should log info, warn, and error when level is info", () => {
      mockGetItem.mockReturnValue("info");
      const log = getLogger("EPBundle");

      log.debug("no");
      log.info("yes");
      log.warn("yes");
      log.error("yes");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("should log everything when level is debug", () => {
      mockGetItem.mockReturnValue("debug");
      const log = getLogger("EPCheckout");

      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");

      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('should log nothing when level is "silent"', () => {
      mockGetItem.mockReturnValue("silent");
      const log = getLogger("EPProduct");

      log.debug("no");
      log.info("no");
      log.warn("no");
      log.error("no");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("should be case-insensitive for level names", () => {
      mockGetItem.mockReturnValue("WARN");
      const log = getLogger("EPCart");

      log.info("no");
      log.warn("yes");

      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // "level:modules" format
  // -----------------------------------------------------------------------
  describe('"level:modules" format', () => {
    it("should allow specified modules at the given level", () => {
      mockGetItem.mockReturnValue("warn:EPStock,EPCart");
      const stockLog = getLogger("EPStock");
      const cartLog = getLogger("EPCart");

      stockLog.warn("stock warning");
      cartLog.warn("cart warning");

      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith("[EP:EPStock] stock warning");
      expect(warnSpy).toHaveBeenCalledWith("[EP:EPCart] cart warning");
    });

    it("should block modules not in the list", () => {
      mockGetItem.mockReturnValue("warn:EPStock");
      const stockLog = getLogger("EPStock");
      const cartLog = getLogger("EPCart");

      stockLog.warn("visible");
      cartLog.warn("invisible");

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith("[EP:EPStock] visible");
    });

    it("should still respect level threshold within allowed modules", () => {
      mockGetItem.mockReturnValue("error:EPProduct");
      const log = getLogger("EPProduct");

      log.debug("no");
      log.info("no");
      log.warn("no");
      log.error("yes");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('should allow all modules when modules part is "*"', () => {
      mockGetItem.mockReturnValue("info:*");
      const logA = getLogger("EPModuleA");
      const logB = getLogger("EPModuleB");

      logA.info("a");
      logB.info("b");

      expect(infoSpy).toHaveBeenCalledTimes(2);
    });

    it("should default to DEBUG level for unrecognized level string in colon format", () => {
      mockGetItem.mockReturnValue("bogus:EPStock");
      const log = getLogger("EPStock");

      log.debug("visible");

      expect(debugSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Comma-separated module names (no level prefix)
  // -----------------------------------------------------------------------
  describe("comma-separated module names", () => {
    it("should enable only listed modules at DEBUG level", () => {
      mockGetItem.mockReturnValue("EPStock,EPCart");
      const stockLog = getLogger("EPStock");
      const cartLog = getLogger("EPCart");
      const otherLog = getLogger("EPProduct");

      stockLog.debug("visible");
      cartLog.debug("visible");
      otherLog.debug("invisible");

      expect(debugSpy).toHaveBeenCalledTimes(2);
    });

    it("should enable a single module name at DEBUG level", () => {
      mockGetItem.mockReturnValue("EPStock");
      const stockLog = getLogger("EPStock");
      const cartLog = getLogger("EPCart");

      stockLog.debug("visible");
      cartLog.debug("invisible");

      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy).toHaveBeenCalledWith("[EP:EPStock] visible");
    });
  });

  // -----------------------------------------------------------------------
  // Tag format
  // -----------------------------------------------------------------------
  describe("tag format [EP:module]", () => {
    it("should prefix messages with [EP:{module}]", () => {
      mockGetItem.mockReturnValue("*");
      const log = getLogger("EPCheckout");

      log.info("order placed");

      expect(infoSpy).toHaveBeenCalledWith("[EP:EPCheckout] order placed");
    });

    it("should use the exact module name provided to createLogger", () => {
      mockGetItem.mockReturnValue("*");
      const log = getLogger("MyCustomModule");

      log.warn("test");

      expect(warnSpy).toHaveBeenCalledWith("[EP:MyCustomModule] test");
    });
  });

  // -----------------------------------------------------------------------
  // Data parameter
  // -----------------------------------------------------------------------
  describe("data parameter", () => {
    it("should pass data object as second argument to console method", () => {
      mockGetItem.mockReturnValue("*");
      const log = getLogger("EPCart");
      const data = { itemId: "abc-123", qty: 2 };

      log.info("item added", data);

      expect(infoSpy).toHaveBeenCalledWith("[EP:EPCart] item added", data);
    });

    it("should not pass a second argument when data is undefined", () => {
      mockGetItem.mockReturnValue("*");
      const log = getLogger("EPCart");

      log.info("simple message");

      expect(infoSpy).toHaveBeenCalledWith("[EP:EPCart] simple message");
      // Verify only one argument was passed (no trailing undefined)
      expect(infoSpy.mock.calls[0]).toHaveLength(1);
    });

    it("should pass data through for every log level", () => {
      mockGetItem.mockReturnValue("*");
      const log = getLogger("EPData");
      const data = { key: "value" };

      log.debug("d", data);
      log.info("i", data);
      log.warn("w", data);
      log.error("e", data);

      expect(debugSpy).toHaveBeenCalledWith("[EP:EPData] d", data);
      expect(infoSpy).toHaveBeenCalledWith("[EP:EPData] i", data);
      expect(warnSpy).toHaveBeenCalledWith("[EP:EPData] w", data);
      expect(errorSpy).toHaveBeenCalledWith("[EP:EPData] e", data);
    });
  });

  // -----------------------------------------------------------------------
  // Console method mapping
  // -----------------------------------------------------------------------
  describe("console method mapping", () => {
    it("debug() should call console.debug", () => {
      mockGetItem.mockReturnValue("*");
      getLogger("X").debug("msg");
      expect(debugSpy).toHaveBeenCalled();
    });

    it("info() should call console.info", () => {
      mockGetItem.mockReturnValue("*");
      getLogger("X").info("msg");
      expect(infoSpy).toHaveBeenCalled();
    });

    it("warn() should call console.warn", () => {
      mockGetItem.mockReturnValue("*");
      getLogger("X").warn("msg");
      expect(warnSpy).toHaveBeenCalled();
    });

    it("error() should call console.error", () => {
      mockGetItem.mockReturnValue("*");
      getLogger("X").error("msg");
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // resetLogConfig
  // -----------------------------------------------------------------------
  describe("resetLogConfig", () => {
    it("should clear cached config so new localStorage value takes effect", () => {
      // First: silent (default)
      mockGetItem.mockReturnValue(null);
      const log = getLogger("EPStock");
      log.debug("invisible");
      expect(debugSpy).not.toHaveBeenCalled();

      // Change config and reset
      mockGetItem.mockReturnValue("*");
      resetConfig();

      log.debug("visible");
      expect(debugSpy).toHaveBeenCalledTimes(1);
    });

    it("should allow switching from verbose back to silent", () => {
      mockGetItem.mockReturnValue("*");
      const log = getLogger("EPProduct");
      log.info("visible");
      expect(infoSpy).toHaveBeenCalledTimes(1);

      // Switch to silent
      mockGetItem.mockReturnValue(null);
      resetConfig();

      log.info("invisible");
      expect(infoSpy).toHaveBeenCalledTimes(1); // still 1, not 2
    });
  });

  // -----------------------------------------------------------------------
  // Config caching
  // -----------------------------------------------------------------------
  describe("config caching", () => {
    it("should only read localStorage once until resetLogConfig is called", () => {
      mockGetItem.mockReturnValue("*");
      const log = getLogger("EPCache");

      log.debug("first");
      log.debug("second");
      log.debug("third");

      // localStorage.getItem should have been called exactly once
      // (the config is cached after the first read)
      expect(mockGetItem).toHaveBeenCalledTimes(1);
      expect(mockGetItem).toHaveBeenCalledWith("EP_DEBUG");
    });

    it("should re-read localStorage after resetLogConfig", () => {
      mockGetItem.mockReturnValue("*");
      const log = getLogger("EPCache");

      log.debug("first call");
      expect(mockGetItem).toHaveBeenCalledTimes(1);

      resetConfig();

      log.debug("second call triggers re-read");
      expect(mockGetItem).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // LogLevel enum export
  // -----------------------------------------------------------------------
  describe("LogLevel enum", () => {
    it("should export expected numeric values", () => {
      const { LogLevel } = require("../logger");

      expect(LogLevel.DEBUG).toBe(0);
      expect(LogLevel.INFO).toBe(1);
      expect(LogLevel.WARN).toBe(2);
      expect(LogLevel.ERROR).toBe(3);
      expect(LogLevel.SILENT).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe("edge cases", () => {
    it("should handle localStorage.getItem throwing an error", () => {
      mockGetItem.mockImplementation(() => {
        throw new Error("SecurityError: access denied");
      });

      const log = getLogger("EPProduct");

      // Should fall back to silent without throwing
      log.debug("no");
      log.error("no");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("should handle whitespace around level and module names", () => {
      mockGetItem.mockReturnValue("  warn : EPStock , EPCart  ");
      const stockLog = getLogger("EPStock");
      const cartLog = getLogger("EPCart");

      stockLog.warn("stock");
      cartLog.warn("cart");

      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it("should handle whitespace-only value as silent", () => {
      mockGetItem.mockReturnValue("   ");
      const log = getLogger("EPProduct");

      log.debug("no");
      log.error("no");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
