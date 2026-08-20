/** @jest-environment jsdom */

const mockUpdateSession = jest.fn().mockResolvedValue({ success: true });
const mockCalculateShipping = jest.fn().mockResolvedValue({ success: true });
const mockPlaceOrder = jest.fn().mockResolvedValue({
  success: true,
  data: {
    session: {
      status: "complete",
      order: { id: "ord-1" },
      totals: { total: 1000 },
    },
  },
});

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children }: any) => children,
  usePlasmicCanvasContext: jest.fn().mockReturnValue(false),
  useDataEnv: () => ({
    checkoutSession: {
      session: { status: "open" },
      updateSession: mockUpdateSession,
      calculateShipping: mockCalculateShipping,
      placeOrder: mockPlaceOrder,
    },
  }),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  (fn as any).default = jest.fn();
  return fn;
});

jest.mock("../../../ep-server-functions/proxy-fetch", () => ({
  callEpProxy: jest.fn(),
}));

import React, { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { DEFAULT_DEBOUNCE_MS } from "../../../const";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EPCheckoutFormProvider, useCheckoutForm } = require("../EPCheckoutFormProvider");

const COMPLETE_SHIPPING = {
  shippingAddress: "123 Main St",
  shippingCity: "Springfield",
  shippingPostal: "12345",
  shippingCountry: "US",
};

interface FormHandle {
  setField: (name: string, value: string) => void;
  placeOrder: () => Promise<void>;
}

function FormHarness({
  seed,
  handleRef,
}: {
  seed?: Record<string, string>;
  handleRef: React.MutableRefObject<FormHandle | null>;
}) {
  const form = useCheckoutForm();
  handleRef.current = {
    setField: form.setField,
    placeOrder: form.placeOrder,
  };
  useEffect(() => {
    if (!seed) return;
    for (const [name, value] of Object.entries(seed)) {
      form.registerField(name, { kind: "text" });
      form.setField(name, value);
    }
    return () => {
      for (const name of Object.keys(seed)) form.unregisterField(name);
    };
    // Seed once on mount — form.setField is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("EPCheckoutFormProvider shipping sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateSession.mockResolvedValue({ success: true });
    mockCalculateShipping.mockResolvedValue({ success: true });
    mockPlaceOrder.mockResolvedValue({
      success: true,
      data: {
        session: {
          status: "complete",
          order: { id: "ord-1" },
          totals: { total: 1000 },
        },
      },
    });
  });

  it("does not calculate shipping for an incomplete address", async () => {
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness
          seed={{ shippingCity: "Springfield" }}
          handleRef={handleRef}
        />
      </EPCheckoutFormProvider>
    );
    await act(async () => {
      await delay(DEFAULT_DEBOUNCE_MS + 50);
    });
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(mockCalculateShipping).not.toHaveBeenCalled();
  });

  it("PATCHes shippingAddress before calculateShipping when the destination is complete", async () => {
    const order: string[] = [];
    mockUpdateSession.mockImplementation(async (payload: unknown) => {
      order.push("update");
      return { success: true, payload };
    });
    mockCalculateShipping.mockImplementation(async () => {
      order.push("calculate");
      return { success: true };
    });

    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness seed={COMPLETE_SHIPPING} handleRef={handleRef} />
      </EPCheckoutFormProvider>
    );

    await waitFor(() => {
      expect(mockCalculateShipping).toHaveBeenCalledTimes(1);
    });
    expect(order).toEqual(["update", "calculate"]);
    expect(mockUpdateSession).toHaveBeenCalledWith({
      shippingAddress: {
        firstName: "",
        lastName: "",
        line1: "123 Main St",
        city: "Springfield",
        postcode: "12345",
        country: "US",
      },
    });
  });

  it("debounces repeated field edits into one calculation", async () => {
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness
          seed={{
            shippingAddress: "1 A St",
            shippingCity: "Springfield",
            shippingPostal: "12345",
            shippingCountry: "US",
          }}
          handleRef={handleRef}
        />
      </EPCheckoutFormProvider>
    );

    await act(async () => {
      handleRef.current?.setField("shippingAddress", "2 B St");
      handleRef.current?.setField("shippingAddress", "3 C St");
    });

    await waitFor(() => {
      expect(mockCalculateShipping).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    expect(mockUpdateSession.mock.calls[0][0].shippingAddress.line1).toBe(
      "3 C St"
    );
  });

  it("does not recalculate an unchanged normalized address", async () => {
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness seed={COMPLETE_SHIPPING} handleRef={handleRef} />
      </EPCheckoutFormProvider>
    );
    await waitFor(() => {
      expect(mockCalculateShipping).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      handleRef.current?.setField("shippingAddress", "123 Main St");
      handleRef.current?.setField("shippingCity", " Springfield ");
    });
    await act(async () => {
      await delay(DEFAULT_DEBOUNCE_MS + 50);
    });

    expect(mockCalculateShipping).toHaveBeenCalledTimes(1);
    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
  });

  it("does not put shipping* values in customAttributes", async () => {
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness
          seed={{
            ...COMPLETE_SHIPPING,
            shippingFirstName: "Jane",
            industry: "retail",
          }}
          handleRef={handleRef}
        />
      </EPCheckoutFormProvider>
    );
    await waitFor(() => {
      expect(mockCalculateShipping).toHaveBeenCalledTimes(1);
    });
    mockCalculateShipping.mockClear();

    await act(async () => {
      await handleRef.current?.placeOrder();
    });

    const submitPayload = mockUpdateSession.mock.calls.at(-1)?.[0];
    expect(submitPayload.customAttributes).toEqual({ industry: "retail" });
    expect(submitPayload.customAttributes.shippingFirstName).toBeUndefined();
    expect(submitPayload.customAttributes.shippingAddress).toBeUndefined();
  });

  it("defensively PATCHes shippingAddress on submit without calling calculateShipping", async () => {
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness seed={COMPLETE_SHIPPING} handleRef={handleRef} />
      </EPCheckoutFormProvider>
    );
    await waitFor(() => {
      expect(mockCalculateShipping).toHaveBeenCalledTimes(1);
    });
    mockCalculateShipping.mockClear();
    mockUpdateSession.mockClear();

    await act(async () => {
      await handleRef.current?.placeOrder();
    });

    expect(mockCalculateShipping).not.toHaveBeenCalled();
    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    const payload = mockUpdateSession.mock.calls[0][0];
    expect(payload.shippingAddress).toEqual({
      firstName: "",
      lastName: "",
      line1: "123 Main St",
      city: "Springfield",
      postcode: "12345",
      country: "US",
    });
    expect(payload.selectedShippingRateId).toBeUndefined();
    expect(mockPlaceOrder).toHaveBeenCalled();
  });

  it("leaves digital checkout unchanged when no shipping* fields are present", async () => {
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness
          seed={{
            firstName: "Jane",
            lastName: "Doe",
            email: "jane@example.com",
            address: "1 Billing Rd",
            city: "Springfield",
            postal: "12345",
            country: "US",
          }}
          handleRef={handleRef}
        />
      </EPCheckoutFormProvider>
    );
    await act(async () => {
      await delay(DEFAULT_DEBOUNCE_MS + 50);
    });

    expect(mockCalculateShipping).not.toHaveBeenCalled();

    await act(async () => {
      await handleRef.current?.placeOrder();
    });

    expect(mockCalculateShipping).not.toHaveBeenCalled();
    const payload = mockUpdateSession.mock.calls[0][0];
    expect(payload.shippingAddress).toBeUndefined();
    expect(payload.customerInfo).toEqual({
      name: "Jane Doe",
      email: "jane@example.com",
    });
    expect(payload.billingAddress.line1).toBe("1 Billing Rd");
    expect(mockPlaceOrder).toHaveBeenCalled();
  });
});
