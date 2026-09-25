/**
 * @jest-environment jsdom
 *
 * A component calls a method; it never sees a URL, and the base path comes
 * from the same context the cart hooks read.
 */
import * as React from "react";
import { act, render } from "@testing-library/react";
import { ShopperContext } from "../../shopper-context/ShopperContext";
import { useEpIdentity } from "../useEpIdentity";

let calls: string[] = [];

function installFetch(): void {
  calls = [];
  // jsdom 20 has no WHATWG Response, so stand in for the parts the client
  // reads rather than pulling a polyfill into the suite.
  (globalThis as any).fetch = async (input: any) => {
    calls.push(String(input));
    return {
      ok: true,
      status: 200,
      json: async () => ({ user: { id: "u1" }, session: { id: "s1" } }),
    };
  };
}

/** Stands in for a registered component that signs a shopper in. */
function SignInButton() {
  const identity = useEpIdentity();
  return (
    <button
      onClick={() =>
        identity.login({ username: "buyer@example.com", password: "pw" })
      }
    >
      Sign in
    </button>
  );
}

describe("useEpIdentity", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(installFetch);
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("works with no provider at all, on the default mount", async () => {
    const { getByText } = render(<SignInButton />);

    await act(async () => {
      getByText("Sign in").click();
    });

    expect(calls).toEqual(["/api/ep/ep/account/login"]);
  });

  it("follows the base path the shopper context carries", async () => {
    const { getByText } = render(
      <ShopperContext basePath="/api/store">
        <SignInButton />
      </ShopperContext>
    );

    await act(async () => {
      getByText("Sign in").click();
    });

    expect(calls).toEqual(["/api/store/ep/account/login"]);
  });

  it("hands back the same client across renders, so it is safe in a dependency list", () => {
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useEpIdentity());
      return null;
    }

    const { rerender } = render(<Probe />);
    rerender(<Probe />);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});
