jest.mock("@plasmicapp/host/registerComponent", () => jest.fn());

import { epCheckoutFormMeta } from "../../../registerEPCheckoutForm";

describe("Elastic Path Checkout Form registration", () => {
  it("hides the Cart ID prop and says it is ignored", () => {
    const { cartId } = epCheckoutFormMeta.props as Record<string, any>;
    expect(cartId.hidden()).toBe(true);
    expect(cartId.description).toMatch(/^Deprecated — ignored\./);
  });
});
