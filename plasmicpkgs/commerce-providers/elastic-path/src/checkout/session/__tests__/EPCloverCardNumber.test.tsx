/**
 * @jest-environment jsdom
 *
 * B-4.3: EPCloverCardNumber component tests
 *
 * Tests card number field rendering: design-time placeholder, outside-context
 * warning, and style props application. Also covers EPCloverCardExpiry,
 * EPCloverCardCVV, and EPCloverCardPostalCode by verifying shared behavior
 * through the internal EPCloverCardFieldInternal component.
 */
/** @jest-environment jsdom */

// Mock @plasmicapp/host
jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children }: any) => <div>{children}</div>,
  usePlasmicCanvasContext: jest.fn().mockReturnValue(false),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  fn.default = jest.fn();
  return fn;
});

import React from "react";
import { render, screen } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPCloverCardNumber } = require("../EPCloverCardNumber") as {
  EPCloverCardNumber: React.FC<any>;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPCloverCardExpiry } = require("../EPCloverCardExpiry") as {
  EPCloverCardExpiry: React.FC<any>;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPCloverCardCVV } = require("../EPCloverCardCVV") as {
  EPCloverCardCVV: React.FC<any>;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPCloverCardPostalCode } = require("../EPCloverCardPostalCode") as {
  EPCloverCardPostalCode: React.FC<any>;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CloverElementsContext } = require("../clover-context") as {
  CloverElementsContext: React.Context<any>;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EPCloverCardNumber", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders design-time placeholder in editor", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    render(<EPCloverCardNumber placeholder="1234 5678 9012 3456" />);
    expect(screen.getByText("1234 5678 9012 3456")).toBeTruthy();
  });

  it("renders default label in editor when no placeholder", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    render(<EPCloverCardNumber />);
    expect(screen.getByText("Card Number")).toBeTruthy();
  });

  it("shows warning when outside EPCloverPayment", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(false);

    render(<EPCloverCardNumber />);
    expect(screen.getByText("Place inside EPCloverPayment")).toBeTruthy();
  });

  it("applies className in editor", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    render(<EPCloverCardNumber className="my-card-number" />);
    expect(document.querySelector(".my-card-number")).toBeTruthy();
  });

  it("renders mount target div when inside CloverElementsContext with elements", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(false);

    const mockElements = {
      create: jest.fn().mockReturnValue({
        mount: jest.fn(),
        destroy: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }),
    };

    const ctxValue = {
      elements: mockElements,
      clover: {} as any,
      isReady: true,
      error: null,
    };

    const { container } = render(
      <CloverElementsContext.Provider value={ctxValue}>
        <EPCloverCardNumber fieldHeight="50px" fieldBorderRadius="8px" />
      </CloverElementsContext.Provider>
    );

    // Should render the container div with styling
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.style.height).toBe("50px");
    expect(wrapper.style.borderRadius).toBe("8px");
  });
});

describe("EPCloverCardExpiry", () => {
  it("renders design-time placeholder", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    render(<EPCloverCardExpiry />);
    expect(screen.getByText("MM / YY")).toBeTruthy();
  });
});

describe("EPCloverCardCVV", () => {
  it("renders design-time placeholder", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    render(<EPCloverCardCVV />);
    expect(screen.getByText("CVV")).toBeTruthy();
  });
});

describe("EPCloverCardPostalCode", () => {
  it("renders design-time placeholder", () => {
    const { usePlasmicCanvasContext } = require("@plasmicapp/host");
    usePlasmicCanvasContext.mockReturnValue(true);

    render(<EPCloverCardPostalCode />);
    expect(screen.getByText("Postal Code")).toBeTruthy();
  });
});
