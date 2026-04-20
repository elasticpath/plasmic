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
  // Proxy cannot wrap non-configurable data properties (arrow function class
  // fields) without violating JS invariants. Instead, walk the full prototype
  // chain and build a plain wrapper object with timed versions of each method.
  const methods = new Map<string, Function>();
  let curr: object = target;
  while (curr && curr !== Object.prototype) {
    for (const prop of Object.getOwnPropertyNames(curr)) {
      if (prop === "constructor" || methods.has(prop)) continue;
      const val = (target as any)[prop];
      if (typeof val === "function") {
        methods.set(prop, val);
      }
    }
    curr = Object.getPrototypeOf(curr);
  }

  const wrapper = Object.create(Object.getPrototypeOf(target));
  for (const [prop, fn] of methods) {
    const name = prefix ? `${prefix}-${prop}` : prop;
    wrapper[prop] = function (...args: unknown[]) {
      const result = fn.apply(target, args);
      if (result instanceof Promise) {
        const start = Date.now();
        return result.finally(() => recordTiming(name, Date.now() - start));
      }
      return result;
    };
  }
  return wrapper as T;
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
