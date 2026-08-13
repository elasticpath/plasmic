const mockLog = jest.fn();

jest.mock("pino", () => {
  const factory: any = () => ({
    info: (...args: unknown[]) => mockLog("info", ...args),
    error: (...args: unknown[]) => mockLog("error", ...args),
    warn: (...args: unknown[]) => mockLog("warn", ...args),
    debug: (...args: unknown[]) => mockLog("debug", ...args),
  });
  factory.stdTimeFunctions = { isoTime: () => "2026-01-01T00:00:00.000Z" };
  return { __esModule: true, default: factory };
});

import { PinoLogger } from "@/wab/server/observability/PinoLogger";

describe("PinoLogger", () => {
  beforeEach(() => mockLog.mockClear());

  function lastEntry() {
    return mockLog.mock.calls[mockLog.mock.calls.length - 1][1];
  }

  it("logs a string message unchanged", () => {
    new PinoLogger().error("plain failure", { projectId: "abc" });

    expect(lastEntry()).toMatchObject({
      message: "plain failure",
      projectId: "abc",
    });
    expect(lastEntry()).not.toHaveProperty("error");
  });

  it("keeps the text when an Error is passed as the message", () => {
    new PinoLogger().error(new Error("connection refused") as any);

    expect(lastEntry()).toMatchObject({
      message: "connection refused",
      error: { name: "Error", message: "connection refused" },
    });
    expect(lastEntry().error.stack).toContain("connection refused");
  });

  it("survives JSON serialization, which drops non-enumerable Error fields", () => {
    new PinoLogger().error(new Error("connection refused") as any);

    // The original defect: JSON.stringify(new Error(...)) is "{}", so an
    // un-expanded Error reached the log sink as only {"name":"..."}.
    expect(JSON.stringify(lastEntry())).toContain("connection refused");
  });

  it("falls back to the error name when the message is empty", () => {
    class AssertionError extends Error {
      constructor() {
        super("");
        this.name = "AssertionError";
      }
    }
    new PinoLogger().error(new AssertionError() as any);

    expect(lastEntry().message).toBe("AssertionError");
  });
});
