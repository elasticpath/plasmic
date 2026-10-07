import type {
  Stripe,
  StripeElements,
  StripeElementsOptions,
  StripePaymentElement,
  StripePaymentElementChangeEvent,
  StripePaymentElementOptions,
} from "@stripe/stripe-js";
import { useEffect, useRef, useState } from "react";

export interface PaymentElementConfig {
  elements: StripeElementsOptions;
  paymentElement?: StripePaymentElementOptions;
  onReady?: () => void;
  onChange?: (event: StripePaymentElementChangeEvent) => void;
}

/**
 * Mounts a Stripe Payment Element into the node given to `ref`. Elements are
 * recreated when the client secret changes; other option changes go through
 * `update`. The element is destroyed when the node or the component goes.
 */
export function usePaymentElement(
  stripe: Stripe | null,
  config: PaymentElementConfig
): { ref: (node: HTMLDivElement | null) => void; elements: StripeElements | null } {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [elements, setElements] = useState<StripeElements | null>(null);
  const live = useRef<{
    elements: StripeElements;
    element: StripePaymentElement;
  } | null>(null);

  const {
    clientSecret,
    loader: _loader,
    ...elementsUpdatable
  } = config.elements as StripeElementsOptions & { clientSecret?: string };
  const elementsUpdate = JSON.stringify(elementsUpdatable);
  const paymentElementUpdate = JSON.stringify(config.paymentElement ?? {});

  const latest = useRef({ config, elementsUpdate, paymentElementUpdate });
  latest.current = { config, elementsUpdate, paymentElementUpdate };
  const applied = useRef({ elementsUpdate: "", paymentElementUpdate: "" });

  useEffect(() => {
    if (!stripe || !container) return;
    const { config: current } = latest.current;
    const created = stripe.elements(current.elements as any);
    const element = created.create("payment", current.paymentElement);
    element.on("ready", () => latest.current.config.onReady?.());
    element.on("change", (event) => latest.current.config.onChange?.(event));
    element.mount(container);
    live.current = { elements: created, element };
    applied.current = {
      elementsUpdate: latest.current.elementsUpdate,
      paymentElementUpdate: latest.current.paymentElementUpdate,
    };
    setElements(created);
    return () => {
      element.destroy();
      live.current = null;
      setElements(null);
    };
  }, [stripe, container, clientSecret]);

  useEffect(() => {
    if (!live.current || applied.current.elementsUpdate === elementsUpdate) {
      return;
    }
    live.current.elements.update(JSON.parse(elementsUpdate));
    applied.current.elementsUpdate = elementsUpdate;
  }, [elements, elementsUpdate]);

  useEffect(() => {
    if (
      !live.current ||
      applied.current.paymentElementUpdate === paymentElementUpdate
    ) {
      return;
    }
    live.current.element.update(JSON.parse(paymentElementUpdate));
    applied.current.paymentElementUpdate = paymentElementUpdate;
  }, [elements, paymentElementUpdate]);

  return { ref: setContainer, elements };
}
