import type { ErrorRequestHandler } from "express";
import { addEndErrorHandlers } from "@/wab/server/AppServer";
import {
  AuthError,
  BadRequestError,
} from "@/wab/shared/ApiErrors/errors";
import { stampIgnoreError } from "@/wab/shared/error-handling";

jest.mock("@/wab/server/observability", () => {
  const loggerInstance = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
  return { logger: () => loggerInstance };
});

function captureErrorHandler(): ErrorRequestHandler {
  let handler: ErrorRequestHandler | undefined;
  const fakeApp = {
    use: (h: ErrorRequestHandler) => {
      handler = h;
    },
  } as any;
  addEndErrorHandlers(fakeApp);
  if (!handler) {
    throw new Error("addEndErrorHandlers did not register a handler");
  }
  return handler;
}

function makeRes() {
  return {
    headersSent: false,
    writableEnded: false,
    get: jest.fn(),
    set: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as any;
}

describe("addEndErrorHandlers", () => {
  async function run(err: Error) {
    const { logger } = jest.requireMock("@/wab/server/observability");
    const handler = captureErrorHandler();
    const req = { get: jest.fn() } as any;
    const res = makeRes();
    await (handler as any)(err, req, res, jest.fn());
    return { logger: logger(), res };
  }

  beforeEach(() => {
    const { logger } = jest.requireMock("@/wab/server/observability");
    Object.values(logger()).forEach((fn: any) => fn.mockClear());
  });

  it("does not log an ignorable message-matched error", async () => {
    const { logger, res } = await run(
      new Error("Query runner already released")
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("does not log an error stamped as ignorable", async () => {
    const { logger } = await run(stampIgnoreError(new Error("boom")));
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does not log an AuthError", async () => {
    const { logger } = await run(new AuthError("nope"));
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs a sub-500 ApiError at warn without a stack, and returns its status code", async () => {
    const { logger, res } = await run(new BadRequestError("bad input"));
    expect(logger.warn).toHaveBeenCalledWith("BadRequestError - bad input");
    expect(logger.error).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("logs an unrecognized error at error level with its stack, and returns 500", async () => {
    const err = new Error("totally unexpected");
    const { logger, res } = await run(err);
    expect(logger.error).toHaveBeenCalledWith(
      "Error - totally unexpected",
      { stack: err.stack }
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
