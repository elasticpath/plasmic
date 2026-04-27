/**
 * AdapterRegistry — registry of payment adapters keyed by gateway name.
 *
 * Consumer route files create a registry, register adapters (Clover, Stripe),
 * and pass it into the SessionHandlerContext. Handlers call getAdapter(name) to
 * dispatch to the correct gateway.
 */
import type { AdapterRegistry, PaymentAdapter } from "./types";

class AdapterRegistryImpl implements AdapterRegistry {
  private adapters = new Map<string, PaymentAdapter>();

  register(name: string, adapter: PaymentAdapter): void {
    this.adapters.set(name, adapter);
  }

  getAdapter(name: string): PaymentAdapter | undefined {
    return this.adapters.get(name);
  }
}

export function createAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistryImpl();
}
