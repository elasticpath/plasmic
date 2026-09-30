/**
 * Door 1 of two, holding `registerAll` shut against the `ep.*` functions.
 *
 * `hostLessRegistry` is spread second in Studio and wins on an id collision,
 * so a single `registerEpCustomFunctions` reachable from `registerAll` moves
 * every consumer's data-query Configure panel into the hostless `about:blank`
 * realm and its `<base href>`-rewritten URLs — canvas unaffected, no error
 * anywhere. Door 2 is the comment in
 * `platform/canvas-packages/src/commerce-elastic-path.ts`, which cannot be
 * asserted from inside this package.
 */
import { registerAll } from "./index";

describe("registerAll", () => {
  it("registers no server functions", () => {
    const registerFunction = jest.fn();
    const noop = jest.fn();

    registerAll({
      registerComponent: noop,
      registerGlobalContext: noop,
      registerFunction,
    } as never);

    expect(noop).toHaveBeenCalled();
    expect(registerFunction).not.toHaveBeenCalled();
  });
});
