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

const sessionDataEnv = () => ({
  checkoutSession: {
    session: { status: "open" },
    updateSession: mockUpdateSession,
    calculateShipping: mockCalculateShipping,
    placeOrder: mockPlaceOrder,
  },
});
const mockUseDataEnv = jest.fn(sessionDataEnv);

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children }: any) => children,
  usePlasmicCanvasContext: jest.fn().mockReturnValue(false),
  useDataEnv: () => mockUseDataEnv(),
}));

jest.mock("@plasmicapp/host/registerComponent", () => {
  const fn = jest.fn();
  (fn as any).default = jest.fn();
  return fn;
});

import React, { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_DEBOUNCE_MS } from "../../../const";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  EPCheckoutFormProvider,
  useCheckoutForm,
  epCheckoutFormProviderMeta,
} = require("../EPCheckoutFormProvider");
const fetchMock = jest.fn();
global.fetch = fetchMock as any;

const COMPLETE_SHIPPING = {
  shippingAddress: "123 Main St",
  shippingCity: "Springfield",
  shippingPostal: "12345",
  shippingCountry: "US",
};

interface FormHandle {
  setField: (name: string, value: string) => void;
  placeOrder: () => Promise<void>;
  status: string;
  error: string | null;
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
    status: form.status,
    error: form.error,
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

  it("does not sync an incomplete address", async () => {
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

  it("PATCHes shippingAddress without requoting when the destination is complete", async () => {
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness seed={COMPLETE_SHIPPING} handleRef={handleRef} />
      </EPCheckoutFormProvider>
    );

    await waitFor(() => {
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await delay(50);
    });
    expect(mockCalculateShipping).not.toHaveBeenCalled();
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

  it("requotes once when the update returns no rates, as an older server does", async () => {
    const order: string[] = [];
    mockUpdateSession.mockImplementation(async () => {
      order.push("update");
      return { success: true, data: { session: { availableShippingRates: [] } } };
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
  });

  it("does not requote when the update already returns rates", async () => {
    mockUpdateSession.mockResolvedValue({
      success: true,
      data: { session: { availableShippingRates: [{ id: "rate-standard" }] } },
    });

    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness seed={COMPLETE_SHIPPING} handleRef={handleRef} />
      </EPCheckoutFormProvider>
    );

    await waitFor(() => {
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await delay(50);
    });
    expect(mockCalculateShipping).not.toHaveBeenCalled();
  });

  it("debounces repeated field edits into one address update", async () => {
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
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateSession.mock.calls[0][0].shippingAddress.line1).toBe(
      "3 C St"
    );
  });

  it("does not re-send an unchanged normalized address", async () => {
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness seed={COMPLETE_SHIPPING} handleRef={handleRef} />
      </EPCheckoutFormProvider>
    );
    await waitFor(() => {
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      handleRef.current?.setField("shippingAddress", "123 Main St");
      handleRef.current?.setField("shippingCity", " Springfield ");
    });
    await act(async () => {
      await delay(DEFAULT_DEBOUNCE_MS + 50);
    });

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
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await handleRef.current?.placeOrder();
    });

    const submitPayload = mockUpdateSession.mock.calls.at(-1)?.[0];
    expect(submitPayload.customAttributes).toEqual({ industry: "retail" });
    expect(submitPayload.customAttributes.shippingFirstName).toBeUndefined();
    expect(submitPayload.customAttributes.shippingAddress).toBeUndefined();
  });

  it("defensively PATCHes shippingAddress on submit without requoting", async () => {
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness seed={COMPLETE_SHIPPING} handleRef={handleRef} />
      </EPCheckoutFormProvider>
    );
    await waitFor(() => {
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    });
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

  it("treats a completed session placeOrder as success", async () => {
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness
          seed={{
            firstName: "Jane",
            lastName: "Doe",
            email: "jane@example.com",
          }}
          handleRef={handleRef}
        />
      </EPCheckoutFormProvider>
    );

    await act(async () => {
      await handleRef.current?.placeOrder();
    });

    expect(handleRef.current?.status).toBe("placed");
    expect(handleRef.current?.error).toBeNull();
  });

  it("shows a refused checkout update and places no order", async () => {
    mockUpdateSession.mockResolvedValueOnce({
      success: false,
      error: {
        code: "PAYMENT_ACTION_PENDING",
        message: "Finish or cancel the card check before changing this checkout",
      },
    });
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness
          seed={{ firstName: "Jane", lastName: "Doe", email: "jane@example.com" }}
          handleRef={handleRef}
        />
      </EPCheckoutFormProvider>
    );

    await act(async () => {
      await handleRef.current?.placeOrder();
    });

    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(handleRef.current?.status).toBe("error");
    expect(handleRef.current?.error).toBe(
      "Finish or cancel the card check before changing this checkout"
    );
  });

  describe("an email the server refuses", () => {
    const INVALID_EMAIL = {
      success: false,
      error: {
        code: "INVALID_EMAIL",
        message: "Enter a valid email address, such as name@example.com.",
      },
    };

    async function submitWith(email: string) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { EPFormField } = require("../EPFormField");
      const handleRef = { current: null as FormHandle | null };
      render(
        <EPCheckoutFormProvider>
          <EPFormField name="email" label="Email" fieldId="email-field" />
          <FormHarness
            seed={{ firstName: "Jane", lastName: "Doe", email }}
            handleRef={handleRef}
          />
        </EPCheckoutFormProvider>
      );
      await act(async () => {
        await handleRef.current?.placeOrder();
      });
      return handleRef;
    }

    function emailInput() {
      return document.getElementById("email-field") as HTMLInputElement;
    }

    it("is shown on the form and on the email field when the update refuses it", async () => {
      mockUpdateSession.mockResolvedValueOnce(INVALID_EMAIL);

      const handleRef = await submitWith("jane doe@example.com");

      expect(mockPlaceOrder).not.toHaveBeenCalled();
      expect(handleRef.current?.status).toBe("error");
      expect(screen.getByRole("alert").textContent).toBe(INVALID_EMAIL.error.message);
      expect(emailInput().getAttribute("aria-invalid")).toBe("true");
      expect(emailInput().parentElement!.textContent).toContain(INVALID_EMAIL.error.message);
    });

    it("is shown on the email field when pay refuses it", async () => {
      mockPlaceOrder.mockResolvedValueOnce(INVALID_EMAIL);

      const handleRef = await submitWith("jane@example.com.");

      expect(handleRef.current?.error).toBe(INVALID_EMAIL.error.message);
      expect(emailInput().getAttribute("aria-invalid")).toBe("true");
    });

    it("clears from the email field once the shopper edits it", async () => {
      mockUpdateSession.mockResolvedValueOnce(INVALID_EMAIL);
      const handleRef = await submitWith("jane doe@example.com");

      act(() => handleRef.current?.setField("email", "jane@example.com"));

      expect(emailInput().getAttribute("aria-invalid")).toBeNull();
    });

    it("does not mark the email field for other refusals", async () => {
      mockUpdateSession.mockResolvedValueOnce({
        success: false,
        error: { code: "SESSION_NOT_OPEN", message: "Session is not open" },
      });

      await submitWith("jane@example.com");

      expect(emailInput().getAttribute("aria-invalid")).toBeNull();
    });
  });

  it("while a card check is open, shows the form locked and finishes the check without sending edits", async () => {
    mockUseDataEnv.mockReturnValue({
      checkoutSession: {
        session: {
          status: "open",
          payment: { status: "requires_action", gateway: "stripe" },
        },
        updateSession: mockUpdateSession,
        calculateShipping: mockCalculateShipping,
        placeOrder: mockPlaceOrder,
      },
    });
    const handleRef = { current: null as FormHandle | null };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { EPFormField } = require("../EPFormField");
      render(
        <EPCheckoutFormProvider>
          <EPFormField name="email" label="Email" fieldId="email-field" />
          <FormHarness handleRef={handleRef} />
        </EPCheckoutFormProvider>
      );

      expect(screen.getByRole("status").textContent).toMatch(/card check/i);
      expect((document.getElementById("email-field") as HTMLInputElement).readOnly).toBe(true);
      await act(async () => {
        await handleRef.current?.placeOrder();
      });

      expect(mockUpdateSession).not.toHaveBeenCalled();
      expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
      expect(handleRef.current?.status).toBe("placed");
    } finally {
      mockUseDataEnv.mockImplementation(sessionDataEnv);
    }
  });

  it("treats a failed payment as an error, not success", async () => {
    mockPlaceOrder.mockResolvedValueOnce({
      success: true,
      data: {
        session: {
          status: "open",
          payment: { status: "failed" },
          order: { id: "ord-1" },
          totals: { total: 1000 },
        },
      },
      paymentError: "Card declined",
    });
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness
          seed={{
            firstName: "Jane",
            lastName: "Doe",
            email: "jane@example.com",
          }}
          handleRef={handleRef}
        />
      </EPCheckoutFormProvider>
    );

    await act(async () => {
      await handleRef.current?.placeOrder();
    });

    expect(handleRef.current?.status).toBe("error");
    expect(handleRef.current?.error).toBe("Card declined");
    expect(screen.getByRole("alert").textContent).toBe("Card declined");
  });

  it("leaves showing a declined card to the page when Show Errors is off", async () => {
    mockPlaceOrder.mockResolvedValueOnce({
      success: true,
      data: { session: { status: "open", payment: { status: "failed" } } },
      paymentError: "Card declined",
    });
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider showError={false}>
        <FormHarness handleRef={handleRef} />
      </EPCheckoutFormProvider>
    );

    await act(async () => {
      await handleRef.current?.placeOrder();
    });

    expect(handleRef.current?.error).toBe("Card declined");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("registers Show Errors as an optional prop that is on by default", () => {
    expect(epCheckoutFormProviderMeta.props.showError).toMatchObject({
      type: "boolean",
      defaultValue: true,
    });
  });

  it("does not treat a leaked requires_action session as placed", async () => {
    mockPlaceOrder.mockResolvedValueOnce({
      success: true,
      data: {
        session: {
          status: "open",
          payment: { status: "requires_action", gateway: "stripe" },
          totals: { total: 1000 },
        },
      },
    });
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness
          seed={{
            firstName: "Jane",
            lastName: "Doe",
            email: "jane@example.com",
          }}
          handleRef={handleRef}
        />
      </EPCheckoutFormProvider>
    );

    await act(async () => {
      await handleRef.current?.placeOrder();
    });

    expect(handleRef.current?.status).toBe("error");
    expect(handleRef.current?.error).toMatch(/did not complete/i);
  });

  it("ignores a second placeOrder while the first is in flight", async () => {
    let resolvePlace: (v: any) => void = () => {};
    mockPlaceOrder.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePlace = resolve;
      })
    );
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider>
        <FormHarness
          seed={{
            firstName: "Jane",
            lastName: "Doe",
            email: "jane@example.com",
          }}
          handleRef={handleRef}
        />
      </EPCheckoutFormProvider>
    );

    let first: Promise<void>;
    await act(async () => {
      first = handleRef.current!.placeOrder();
    });
    await act(async () => {
      await handleRef.current!.placeOrder();
    });
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePlace({
        success: true,
        data: {
          session: {
            status: "complete",
            order: { id: "ord-1" },
            totals: { total: 1000 },
          },
        },
      });
      await first;
    });
  });
});

describe("EPCheckoutFormProvider setup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDataEnv.mockImplementation(sessionDataEnv);
  });

  const SEED = { firstName: "Jane", lastName: "Doe", email: "jane@example.com" };

  async function placeWith(props: Record<string, unknown>) {
    const handleRef = { current: null as FormHandle | null };
    render(
      <EPCheckoutFormProvider {...props}>
        <FormHarness seed={SEED} handleRef={handleRef} />
      </EPCheckoutFormProvider>
    );
    await act(async () => {
      await handleRef.current?.placeOrder();
    });
    return handleRef.current!;
  }

  it("offers no proxy Payment Mode", () => {
    expect(epCheckoutFormProviderMeta.props.paymentMode.options).toEqual([
      "auto",
      "session",
    ]);
  });

  it.each(["paymentGateway", "paymentMethod"])(
    "hides %s and describes it as ignored",
    (name) => {
      const prop = epCheckoutFormProviderMeta.props[name];
      expect(prop.hidden()).toBe(true);
      expect(prop.description).toMatch(/^Deprecated — ignored\./);
    }
  );

  it("shows a setup error for a stored proxy Payment Mode and places no order", async () => {
    const form = await placeWith({ paymentMode: "proxy" });

    expect(screen.getByRole("alert").textContent).toContain(
      "EP Checkout Session Provider"
    );
    expect(form.status).toBe("error");
    expect(form.error).toContain("EP Checkout Session Provider");
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["session", "auto"])(
    "shows a setup error for %s mode with no session provider above the form",
    async (paymentMode) => {
      mockUseDataEnv.mockImplementation(() => ({}) as any);

      const onError = jest.fn();
      const form = await placeWith({ paymentMode, onError });

      expect(screen.getByRole("alert").textContent).toContain(
        "EP Checkout Session Provider"
      );
      expect(form.status).toBe("error");
      expect(onError).toHaveBeenCalledWith({
        message: expect.stringContaining("EP Checkout Session Provider"),
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("shows no setup error under a session provider", async () => {
    await placeWith({ paymentMode: "session" });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(mockPlaceOrder).toHaveBeenCalled();
  });
});
