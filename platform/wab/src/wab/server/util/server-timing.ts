import { AsyncLocalStorage } from "async_hooks";

interface TimingEntry {
  name: string;
  dur: number;
  desc?: string;
}

const storage = new AsyncLocalStorage<TimingEntry[]>();

export function runWithServerTiming<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run([], fn);
}

export function recordTiming(name: string, dur: number, desc?: string) {
  storage.getStore()?.push({ name, dur, desc });
}

export async function withTiming<T>(
  name: string,
  fn: () => Promise<T>,
  desc?: string
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    recordTiming(name, Date.now() - start, desc);
  }
}

export function timedProxy<T extends object>(target: T, prefix = ""): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const val = Reflect.get(obj, prop, receiver);
      if (typeof val !== "function") return val;
      const name = prefix ? `${prefix}-${String(prop)}` : String(prop);
      return function (this: unknown, ...args: unknown[]) {
        const result = (val as Function).apply(this ?? obj, args);
        if (result instanceof Promise) {
          const start = Date.now();
          return result.finally(() => {
            recordTiming(name, Date.now() - start);
          });
        }
        return result;
      };
    },
  });
}

export function getServerTimingHeader(): string | undefined {
  const store = storage.getStore();
  if (!store || store.length === 0) return undefined;
  return store
    .map(({ name, dur, desc }) => {
      const safeName = name.replace(/[^a-zA-Z0-9_\-]/g, "-");
      return desc
        ? `${safeName};dur=${dur.toFixed(1)};desc="${desc}"`
        : `${safeName};dur=${dur.toFixed(1)}`;
    })
    .join(", ");
}
