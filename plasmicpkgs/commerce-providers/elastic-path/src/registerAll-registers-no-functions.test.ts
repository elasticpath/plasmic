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
