/**
 * A fake Stripe.js for component tests. Tests swap it in for the loader:
 *
 *   const mockStripeJs = createFakeStripeJs();
 *   jest.mock(".../stripe/load-stripe-js", () => ({
 *     loadStripeJs: () => mockStripeJs.load(),
 *   }));
 *
 * The Payment Element renders a `stripe-payment-element` node into the
 * container it is mounted in, and fires `ready` on the next tick.
 */

export interface FakePaymentElement {
  options: any;
  destroyed: boolean;
  fire(event: string, payload?: any): void;
}

export interface FakeElements {
  options: any;
  submit: jest.Mock;
  update: jest.Mock;
  paymentElement: FakePaymentElement | null;
}

export interface FakeStripe {
  key: string;
  options: any;
  elements: jest.Mock;
  createConfirmationToken: jest.Mock;
  handleNextAction: jest.Mock;
  confirmPayment: jest.Mock;
  lastElements: FakeElements | null;
}

function createPaymentElement(options: any): FakePaymentElement & {
  on(event: string, handler: (payload?: any) => void): void;
  mount(container: HTMLElement): void;
  update(options: any): void;
  destroy(): void;
} {
  const handlers: Record<string, (payload?: any) => void> = {};
  let node: HTMLElement | null = null;
  const element = {
    options,
    destroyed: false,
    on(event: string, handler: (payload?: any) => void) {
      handlers[event] = handler;
    },
    fire(event: string, payload?: any) {
      handlers[event]?.(payload);
    },
    mount(container: HTMLElement) {
      node = document.createElement("div");
      node.setAttribute("data-testid", "stripe-payment-element");
      container.appendChild(node);
      setTimeout(() => handlers.ready?.({}), 0);
    },
    update(next: any) {
      element.options = { ...element.options, ...next };
    },
    destroy() {
      element.destroyed = true;
      node?.remove();
      node = null;
    },
  };
  return element;
}

function createElements(options: any): FakeElements & {
  create(type: string, options: any): ReturnType<typeof createPaymentElement>;
  getElement(type: string): FakePaymentElement | null;
} {
  const elements = {
    options: { ...options },
    paymentElement: null as ReturnType<typeof createPaymentElement> | null,
    submit: jest.fn().mockResolvedValue({}),
    update: jest.fn((next: any) => {
      elements.options = { ...elements.options, ...next };
    }),
    create(_type: string, elementOptions: any) {
      elements.paymentElement = createPaymentElement(elementOptions);
      return elements.paymentElement;
    },
    getElement(type: string) {
      return type === "payment" ? elements.paymentElement : null;
    },
  };
  return elements;
}

export function createFakeStripeJs() {
  const instances: FakeStripe[] = [];
  const Stripe = jest.fn((key: string, options?: any) => {
    const stripe: FakeStripe = {
      key,
      options,
      lastElements: null,
      elements: jest.fn((elementsOptions: any) => {
        stripe.lastElements = createElements(elementsOptions);
        return stripe.lastElements;
      }),
      createConfirmationToken: jest
        .fn()
        .mockResolvedValue({ confirmationToken: { id: "ctoken_fake" } }),
      handleNextAction: jest
        .fn()
        .mockResolvedValue({ paymentIntent: { status: "succeeded" } }),
      confirmPayment: jest.fn().mockResolvedValue({
        paymentIntent: { id: "pi_fake", status: "succeeded" },
      }),
    };
    instances.push(stripe);
    return stripe;
  });
  const load = jest.fn(() => Promise.resolve(Stripe));
  return {
    Stripe,
    load,
    instances,
    last(): FakeStripe {
      const stripe = instances[instances.length - 1];
      if (!stripe) throw new Error("Stripe was never constructed");
      return stripe;
    },
    reset() {
      instances.length = 0;
      Stripe.mockClear();
      load.mockClear();
      load.mockImplementation(() => Promise.resolve(Stripe));
    },
  };
}
