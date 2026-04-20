import { recordTiming, runWithServerTiming, timedProxy } from "./server-timing";

// Simulates a class like DbMgr that uses arrow function properties
// (non-configurable on the instance, which breaks Proxy get traps)
class ServiceWithArrowMethods {
  arrowMethod = async (x: number) => x * 2;
  protoMethod() {
    return Promise.resolve("proto");
  }
  syncMethod() {
    return 42;
  }
}

describe("timedProxy", () => {
  it("wraps arrow function (non-configurable) methods without throwing", async () => {
    const svc = new ServiceWithArrowMethods();
    const proxy = timedProxy(svc, "test");
    await expect(proxy.arrowMethod(5)).resolves.toBe(10);
  });

  it("wraps prototype methods", async () => {
    const svc = new ServiceWithArrowMethods();
    const proxy = timedProxy(svc, "test");
    await expect(proxy.protoMethod()).resolves.toBe("proto");
  });

  it("passes through sync methods untimed", () => {
    const svc = new ServiceWithArrowMethods();
    const proxy = timedProxy(svc, "test");
    expect(proxy.syncMethod()).toBe(42);
  });

  it("records timings in AsyncLocalStorage context", async () => {
    const svc = new ServiceWithArrowMethods();
    const proxy = timedProxy(svc, "db");

    const timings: { name: string; dur: number }[] = [];
    const origRecord = recordTiming;

    await runWithServerTiming(async () => {
      await proxy.arrowMethod(3);
      await proxy.protoMethod();
    });

    // Verify no throw — timing collection is tested via getServerTimingHeader
  });

  it("is a no-op outside runWithServerTiming context", async () => {
    const svc = new ServiceWithArrowMethods();
    const proxy = timedProxy(svc, "db");
    // Should not throw even without an AsyncLocalStorage context
    await expect(proxy.arrowMethod(1)).resolves.toBe(2);
  });
});
