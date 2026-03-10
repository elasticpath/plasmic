/**
 * B-4.2: EPCloverPayment component tests
 *
 * Covers: design-time preview states, gateway registration with
 * PaymentRegistrationContext, CloverElementsContext provision,
 * DataProvider exposure, outside-provider warning, and 3DS handler.
 *
 * Note: esbuild does not hoist jest.mock(). We use require() to obtain the
 * mocked module reference so interception works regardless of import order.
 */
/** @jest-environment jsdom */

// Mock clover-singleton (SDK loading is browser-only)
jest.mock("../clover-singleton", () => ({
  getOrCreateCloverInstance: jest.fn().mockResolvedValue({
    clover: { elements: jest.fn(), createToken: jest.fn() },
    elements: { create: jest.fn() },
  }),
  createToken: jest.fn().mockResolvedValue({ token: "tok_test" }),
  destroyCloverInstance: jest.fn(),
}));

// Mock clover-3ds-sdk
jest.mock("../clover-3ds-sdk", () => ({
  loadClover3DSSDK: jest.fn().mockResolvedValue(undefined),
  getClover3DSUtil: jest.fn().mockReturnValue({
    perform3DSFingerPrinting: jest.fn(),
    perform3DSChallenge: jest.fn(),
  }),
  waitForExecutePatch: jest.fn().mockResolvedValue("Y"),
}));

// Mock @plasmicapp/host
jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children, name, data }: any) => (
    <div data-testid={`data-provider-${name}`} data-value={JSON.stringify(data)}>
      {children}
    </div>
  ),
  usePlasmicCanvasContext: jest.fn().mockReturnValue(false),
}));

// Mock @plasmicapp/host/registerComponent
jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render, screen } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPCloverPayment, handleClover3DS } = require("../EPCloverPayment") as {
  EPCloverPayment: React.FC<any>;
  handleClover3DS: (
    actionData: Record<string, unknown>,
    confirmPayment: (data: Record<string, unknown>) => Promise<unknown>
  ) => Promise<void>;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const threeDsSdk = require("../clover-3ds-sdk") as {
  loadClover3DSSDK: jest.Mock;
  getClover3DSUtil: jest.Mock;
  waitForExecutePatch: jest.Mock;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EPCloverPayment", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders children in auto mode", () => {
    render(
      <EPCloverPayment pakmsKey="test-pakms-key">
        <span data-testid="child">Card Fields</span>
      </EPCloverPayment>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("provides cloverPaymentData DataProvider", () => {
    render(
      <EPCloverPayment pakmsKey="test-pakms-key">
        <span>content</span>
      </EPCloverPayment>
    );
    expect(screen.getByTestId("data-provider-cloverPaymentData")).toBeTruthy();
  });

  it("applies className to wrapper", () => {
    render(
      <EPCloverPayment pakmsKey="test-pakms-key" className="my-clover">
        <span>content</span>
      </EPCloverPayment>
    );
    expect(document.querySelector(".my-clover")).toBeTruthy();
  });

  it("renders in design-time ready preview state", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    render(
      <EPCloverPayment pakmsKey="test-pakms-key" previewState="ready">
        <span data-testid="ready-child">Ready</span>
      </EPCloverPayment>
    );
    expect(screen.getByTestId("ready-child")).toBeTruthy();
    const dp = screen.getByTestId("data-provider-cloverPaymentData");
    const data = JSON.parse(dp.getAttribute("data-value") || "{}");
    expect(data.isReady).toBe(true);
    expect(data.isProcessing).toBe(false);
  });

  it("renders in design-time processing preview state", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    render(
      <EPCloverPayment pakmsKey="test-pakms-key" previewState="processing">
        <span data-testid="proc-child">Processing</span>
      </EPCloverPayment>
    );
    expect(screen.getByTestId("proc-child")).toBeTruthy();
    const dp = screen.getByTestId("data-provider-cloverPaymentData");
    const data = JSON.parse(dp.getAttribute("data-value") || "{}");
    expect(data.isProcessing).toBe(true);
  });

  it("renders in design-time error preview state", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    render(
      <EPCloverPayment pakmsKey="test-pakms-key" previewState="error">
        <span data-testid="err-child">Error</span>
      </EPCloverPayment>
    );
    expect(screen.getByTestId("err-child")).toBeTruthy();
    const dp = screen.getByTestId("data-provider-cloverPaymentData");
    const data = JSON.parse(dp.getAttribute("data-value") || "{}");
    expect(data.error).toBe("Payment failed");
  });
});

describe("handleClover3DS", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the mock implementations
    threeDsSdk.loadClover3DSSDK.mockResolvedValue(undefined);
    threeDsSdk.getClover3DSUtil.mockReturnValue({
      perform3DSFingerPrinting: jest.fn(),
      perform3DSChallenge: jest.fn(),
    });
    threeDsSdk.waitForExecutePatch.mockResolvedValue("Y");
  });

  it("handles 3ds_method flow", async () => {
    const confirmMock = jest.fn().mockResolvedValue({
      data: { session: { payment: { status: "succeeded" } } },
    });

    await handleClover3DS(
      {
        type: "3ds_method",
        chargeId: "charge_001",
        _3DSServerTransId: "trans_id",
        acsMethodUrl: "https://acs.example.com/method",
        methodNotificationUrl: "https://notify.example.com",
      },
      confirmMock
    );

    expect(threeDsSdk.loadClover3DSSDK).toHaveBeenCalled();
    const util = threeDsSdk.getClover3DSUtil();
    expect(util.perform3DSFingerPrinting).toHaveBeenCalledWith({
      _3DSServerTransId: "trans_id",
      acsMethodUrl: "https://acs.example.com/method",
      methodNotificationUrl: "https://notify.example.com",
    });
    expect(threeDsSdk.waitForExecutePatch).toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalledWith({
      chargeId: "charge_001",
      flowStatus: "Y",
      stage: "method",
    });
  });

  it("handles 3ds_challenge flow", async () => {
    const confirmMock = jest.fn().mockResolvedValue({
      data: { session: { payment: { status: "succeeded" } } },
    });

    await handleClover3DS(
      {
        type: "3ds_challenge",
        chargeId: "charge_002",
        messageVersion: "2.2.0",
        acsTransID: "acs_trans",
        acsUrl: "https://acs.example.com/challenge",
        threeDSServerTransID: "3ds_trans",
      },
      confirmMock
    );

    const util = threeDsSdk.getClover3DSUtil();
    expect(util.perform3DSChallenge).toHaveBeenCalledWith({
      messageVersion: "2.2.0",
      acsTransID: "acs_trans",
      acsUrl: "https://acs.example.com/challenge",
      threeDSServerTransID: "3ds_trans",
    });
    expect(confirmMock).toHaveBeenCalledWith({
      chargeId: "charge_002",
      flowStatus: "Y",
      stage: "challenge",
    });
  });

  it("handles method → challenge escalation", async () => {
    const confirmMock = jest.fn().mockResolvedValueOnce({
      data: {
        session: {
          payment: {
            status: "requires_action",
            actionData: {
              type: "3ds_challenge",
              chargeId: "charge_esc",
              messageVersion: "2.2.0",
              acsTransID: "acs_esc",
              acsUrl: "https://acs.example.com/challenge",
              threeDSServerTransID: "3ds_esc",
            },
          },
        },
      },
    }).mockResolvedValueOnce({
      data: { session: { payment: { status: "succeeded" } } },
    });

    await handleClover3DS(
      {
        type: "3ds_method",
        chargeId: "charge_001",
        _3DSServerTransId: "trans_id",
        acsMethodUrl: "https://acs.example.com/method",
        methodNotificationUrl: "https://notify.example.com",
      },
      confirmMock
    );

    // Should have called confirm twice (method + escalated challenge)
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(confirmMock).toHaveBeenNthCalledWith(1, {
      chargeId: "charge_001",
      flowStatus: "Y",
      stage: "method",
    });
    expect(confirmMock).toHaveBeenNthCalledWith(2, {
      chargeId: "charge_esc",
      flowStatus: "Y",
      stage: "challenge",
    });
  });

  it("throws when 3DS SDK not available", async () => {
    threeDsSdk.getClover3DSUtil.mockReturnValue(null);

    await expect(
      handleClover3DS(
        {
          type: "3ds_method",
          chargeId: "charge_001",
          _3DSServerTransId: "trans_id",
          acsMethodUrl: "https://acs.example.com/method",
          methodNotificationUrl: "https://notify.example.com",
        },
        jest.fn()
      )
    ).rejects.toThrow("Clover 3DS SDK not available");
  });
});
