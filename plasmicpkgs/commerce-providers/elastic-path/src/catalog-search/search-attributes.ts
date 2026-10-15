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

let discovery: Promise<SearchAttribute[] | null> | undefined;

export function resetSearchAttributeDiscovery(): void {
  discovery = undefined;
}

function discover(): Promise<SearchAttribute[] | null> {
  if (!discovery) {
    const attempt = requestDesignSearchAttributes()
      .catch(() => null)
      .then((found) => {
        if (!found && discovery === attempt) discovery = undefined;
        return found;
      });
    discovery = attempt;
  }
  return discovery;
}

/** Hands the store's filterable fields to Studio once the design-time route answers. */
export function useSearchAttributeDiscovery(
  setControlContextData: ((data: SearchAttributeContext) => void) | undefined
): void {
  const enabled = !!setControlContextData;
  const [attributes, setAttributes] = useState<SearchAttribute[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    discover().then((found) => {
      if (live && found) setAttributes(found);
    });
    return () => {
      live = false;
    };
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
