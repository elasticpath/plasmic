/* eslint-disable @typescript-eslint/no-var-requires */
type CallErrorModule = typeof import("../call-error");

function loadCopy(): CallErrorModule {
  let copy: CallErrorModule | undefined;
  jest.isolateModules(() => {
    copy = require("../call-error");
  });
  return copy as CallErrorModule;
}

describe("call errors across package copies", () => {
  const appCopy = loadCopy();
  const bundleCopy = loadCopy();

  it("keeps the code another copy put on the error", () => {
    const err = bundleCopy.makeEpCallError({
      message: "There isn't enough stock to add that quantity.",
      code: "insufficient_stock",
    });

    expect(appCopy.classifyEpFailure(err)).toBe("insufficient_stock");
  });

  it("knows another copy's error carries the forwarded message", () => {
    const err = bundleCopy.makeEpCallError({
      message: "The requested quantity exceeds the available stock",
      forwarded: true,
    });

    expect(appCopy.carriesForwardedMessage(err)).toBe(true);
  });

  it("does not take a code it did not put on the error", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });

    expect(appCopy.classifyEpFailure(err)).toBe("dispatch_failed");
    expect(appCopy.carriesForwardedMessage(err)).toBe(false);
  });
});
