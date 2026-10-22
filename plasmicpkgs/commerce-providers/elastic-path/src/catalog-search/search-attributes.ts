/**
 * Design-time discovery of the fields a filter component can filter on.
 *
 * Studio calls a prop's `options` synchronously and unawaited, so the list
 * cannot be fetched there: it is fetched while the component renders on the
 * canvas, handed over with `setControlContextData`, and read back by the
 * synchronous `options` below.
 */
import { useEffect, useState } from "react";
import { requestDesignSearchAttributes } from "../ep-server-functions/getSearchAttributes";
import type { SearchAttribute } from "../ep-server-functions/getSearchAttributes";

export interface SearchAttributeContext {
  attributes: SearchAttribute[];
}

type Listener = (attributes: SearchAttribute[]) => void;

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 32_000];
const MIN_GAP_MS = 5_000;

let found: SearchAttribute[] | null = null;
let pending: Promise<void> | undefined;
let failures = 0;
let lastAttempt = -Infinity;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDue = Infinity;
const listeners = new Set<Listener>();

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = undefined;
  retryDue = Infinity;
}

function retryIn(ms: number): void {
  const due = Date.now() + ms;
  if (listeners.size === 0 || due >= retryDue) return;
  clearRetry();
  retryDue = due;
  retryTimer = setTimeout(() => {
    clearRetry();
    attempt();
  }, ms);
}

function attempt(): void {
  if (found || pending || listeners.size === 0) return;
  clearRetry();
  lastAttempt = Date.now();
  const current: Promise<void> = requestDesignSearchAttributes()
    .catch(() => null)
    .then((result) => {
      if (pending !== current) return;
      pending = undefined;
      if (result) {
        found = result;
        listeners.forEach((listener) => listener(result));
        return;
      }
      failures += 1;
      const delay = RETRY_DELAYS_MS[failures - 1];
      if (delay !== undefined) retryIn(delay);
    });
  pending = current;
}

function askSoon(): void {
  if (found || pending) return;
  const wait = lastAttempt + MIN_GAP_MS - Date.now();
  if (wait <= 0) attempt();
  else retryIn(wait);
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("focus", askSoon);
  }
  if (found) listener(found);
  else askSoon();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearRetry();
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", askSoon);
    }
  };
}

export function resetSearchAttributeDiscovery(): void {
  clearRetry();
  found = null;
  pending = undefined;
  failures = 0;
  lastAttempt = -Infinity;
}

/**
 * Hands the store's filterable fields to Studio once the design-time route
 * answers. Every mounted filter shares one discovery; after a failure it is
 * retried with backoff, then on the next canvas focus or filter mount.
 */
export function useSearchAttributeDiscovery(
  setControlContextData: ((data: SearchAttributeContext) => void) | undefined
): void {
  const enabled = !!setControlContextData;
  const [attributes, setAttributes] = useState<SearchAttribute[] | null>(
    () => (enabled ? found : null)
  );

  useEffect(() => {
    if (!enabled) return;
    return subscribe(setAttributes);
  }, [enabled]);

  if (attributes) setControlContextData?.({ attributes });
}

function withSaved(saved: string | undefined, options: string[]): string[] {
  return saved && !options.includes(saved) ? [saved, ...options] : options;
}

export function attributeOptions(
  saved: string | undefined,
  ctx: SearchAttributeContext | null | undefined
): string[] {
  return withSaved(
    saved,
    (ctx?.attributes ?? []).map((a) => a.path)
  );
}

export function numericAttributeOptions(
  saved: string | undefined,
  ctx: SearchAttributeContext | null | undefined
): string[] {
  return withSaved(
    saved,
    (ctx?.attributes ?? []).filter((a) => a.numeric).map((a) => a.path)
  );
}

const LEVEL = /^(.+)\.lvl(\d+)$/;

export function hierarchyOptions(
  saved: string | undefined,
  ctx: SearchAttributeContext | null | undefined
): { label: string; value: string }[] {
  const groups = new Map<string, { level: number; path: string }[]>();
  for (const { path } of ctx?.attributes ?? []) {
    const match = LEVEL.exec(path);
    if (!match) continue;
    const levels = groups.get(match[1]) ?? [];
    levels.push({ level: Number(match[2]), path });
    groups.set(match[1], levels);
  }
  const options = [...groups].map(([prefix, levels]) => ({
    label: `${prefix} (${levels.length} ${levels.length === 1 ? "level" : "levels"})`,
    value: levels
      .sort((a, b) => a.level - b.level)
      .map((l) => l.path)
      .join(","),
  }));
  return saved && !options.some((o) => o.value === saved)
    ? [{ label: saved, value: saved }, ...options]
    : options;
}
