/**
 * A fake Stripe.js for component tests. Tests swap it in for the loader:
 *
 *   const mockStripeJs = createFakeStripeJs();
 *   jest.mock(".../stripe/load-stripe-js", () => ({
 *     loadStripeJs: () => mockStripeJs.load(),
 *   }));
 *
 * The Payment Element renders a `stripe-payment-element` node into the
 * container it is mounted in, and fires `ready` on the next tick. Like
 * Stripe.js, createConfirmationToken rejects Elements that this instance
 * did not create or that were not submitted first.
 */

export interface FakePaymentElement {
  options: any;
  destroyed: boolean;
  fire(event: string, payload?: any): void;
}

export interface FakeElements {
  options: any;
  submitted: boolean;
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
    submitted: false,
    paymentElement: null as ReturnType<typeof createPaymentElement> | null,
    submit: jest.fn(async () => {
      elements.submitted = true;
      return {};
    }),
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
  const hooks: { onConstruct?: (stripe: FakeStripe) => void } = {};
  const Stripe = jest.fn((key: string, options?: any) => {
    const created: FakeElements[] = [];
    const stripe: FakeStripe = {
      key,
      options,
      lastElements: null,
      elements: jest.fn((elementsOptions: any) => {
        stripe.lastElements = createElements(elementsOptions);
        created.push(stripe.lastElements);
        return stripe.lastElements;
      }),
      createConfirmationToken: jest.fn(async (params: any) => {
        const elements = params?.elements;
        if (!created.includes(elements)) {
          throw new Error(
            "IntegrationError: elements must come from this Stripe instance"
          );
        }
        if (!elements.submitted) {
          throw new Error(
            "IntegrationError: elements.submit() must be called before createConfirmationToken()"
          );
        }
        return { confirmationToken: { id: "ctoken_fake" } };
      }),
      handleNextAction: jest
        .fn()
        .mockResolvedValue({ paymentIntent: { status: "succeeded" } }),
      confirmPayment: jest.fn().mockResolvedValue({
        paymentIntent: { id: "pi_fake", status: "succeeded" },
      }),
    };
    instances.push(stripe);
    hooks.onConstruct?.(stripe);
    return stripe;
  });
  const load = jest.fn(() => Promise.resolve(Stripe));
  return {
    Stripe,
    load,
    instances,
    hooks,
    last(): FakeStripe {
      const stripe = instances[instances.length - 1];
      if (!stripe) throw new Error("Stripe was never constructed");
      return stripe;
    },
    reset() {
      instances.length = 0;
      delete hooks.onConstruct;
      Stripe.mockClear();
      load.mockClear();
      load.mockImplementation(() => Promise.resolve(Stripe));
    },
  };
}
