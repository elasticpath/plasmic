/**
 * cloneWithInjectedHandlers — Pattern C helper for catalog-search components.
 *
 * Clones a single React element, injecting behavioral props (e.g. onClick,
 * disabled). Compose-keys merge functions: designer's handler runs first,
 * then the injected one. Override keys replace whatever was there.
 *
 * Non-element children (strings, arrays, fragments, null) are returned
 * unchanged — fail-open. Designers whose layout breaks auto-injection use
 * the per-component context (e.g. $ctx.clearRefinementsData.clear) instead.
 */

import React from "react";

export interface CloneWithInjectedHandlersOptions {
  injected: Record<string, unknown>;
  compose?: string[];
}

export function cloneWithInjectedHandlers(
  child: React.ReactNode,
  options: CloneWithInjectedHandlersOptions
): React.ReactNode {
  if (!React.isValidElement(child)) return child;

  const { injected, compose = [] } = options;
  const composeSet = new Set(compose);
  const existing = (child.props ?? {}) as Record<string, unknown>;

  const merged: Record<string, unknown> = {};
  for (const key of Object.keys(injected)) {
    const injectedVal = injected[key];
    if (
      composeSet.has(key) &&
      typeof existing[key] === "function" &&
      typeof injectedVal === "function"
    ) {
      const designerFn = existing[key] as (...args: unknown[]) => unknown;
      const injectedFn = injectedVal as (...args: unknown[]) => unknown;
      merged[key] = (...args: unknown[]) => {
        designerFn(...args);
        injectedFn(...args);
      };
    } else {
      merged[key] = injectedVal;
    }
  }

  return React.cloneElement(
    child,
    merged as Partial<unknown> & React.Attributes
  );
}
