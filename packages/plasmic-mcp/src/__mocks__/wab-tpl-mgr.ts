/**
 * Mock for @/wab/shared/TplMgr
 *
 * Provides mockable stubs for TplMgr methods used by edit-tools.ts:
 * - ensureBaseVariantSetting/ensureBaseVariant: variant management
 * - renameComponent: component renaming with deduplication
 * - removeComponent: component deletion with reference guards
 * - createStyleVariant: component-level interaction state (hover/focus/pressed)
 * - createPrivateStyleVariant: element-scoped interaction state
 * - createVariantGroup: named variant group with state/param setup
 * - createVariant: add variant to existing group
 * - getUniqueParamName: param name deduplication
 * - renameParam: rename param + fix expressions
 */

import { vi } from "vitest";

export const mockEnsureBaseVariantSetting = vi.fn();
export const mockEnsureBaseVariant = vi.fn();
export const mockRenameComponent = vi.fn((component: any, name: string) => {
  // Default behavior mirrors real TplMgr: update component.name
  component.name = name;
});
export const mockRemoveComponent = vi.fn();
export const mockCreateStyleVariant = vi.fn();
export const mockCreatePrivateStyleVariant = vi.fn();
export const mockCreateVariantGroup = vi.fn();
export const mockCreateVariant = vi.fn();
export const mockAddStyleToken = vi.fn();
export const mockRenameStyleToken = vi.fn();
export const mockDuplicateStyleToken = vi.fn();
export const mockRemoveComponentQuery = vi.fn(
  (component: any, query: any) => {
    const idx = component.dataQueries?.indexOf(query);
    if (idx !== undefined && idx >= 0) component.dataQueries.splice(idx, 1);
  }
);
export const mockRemoveComponentServerQuery = vi.fn(
  (component: any, query: any) => {
    const idx = component.serverQueries?.indexOf(query);
    if (idx !== undefined && idx >= 0) component.serverQueries.splice(idx, 1);
  }
);
export const mockClearReferencesToRemovedQueries = vi.fn();
export const mockGetUniqueParamName = vi.fn(
  (_component: any, name?: string) => name ?? "Unnamed Prop"
);
export const mockRenameParam = vi.fn(
  (_component: any, param: any, name: string) => {
    if (param.variable) {
      param.variable.name = name;
    }
  }
);

export class TplMgr {
  constructor(_args: { site: any }) {}

  ensureBaseVariantSetting(tpl: any): any {
    return mockEnsureBaseVariantSetting(tpl);
  }

  ensureBaseVariant(comp: any): any {
    return mockEnsureBaseVariant(comp);
  }

  renameComponent(component: any, name: string): void {
    mockRenameComponent(component, name);
  }

  removeComponent(component: any): void {
    mockRemoveComponent(component);
  }

  createStyleVariant(component: any, selectors?: string[]): any {
    return mockCreateStyleVariant(component, selectors);
  }

  createPrivateStyleVariant(component: any, tpl: any, selectors?: string[]): any {
    return mockCreatePrivateStyleVariant(component, tpl, selectors);
  }

  createVariantGroup(opts: { component: any; name?: string; optionsType?: string }): any {
    return mockCreateVariantGroup(opts);
  }

  createVariant(component: any, group: any, name?: string): any {
    return mockCreateVariant(component, group, name);
  }

  addStyleToken(opts: any): any {
    return mockAddStyleToken(opts);
  }

  renameStyleToken(token: any, name: string): void {
    mockRenameStyleToken(token, name);
  }

  duplicateStyleToken(token: any): any {
    return mockDuplicateStyleToken(token);
  }

  getUniqueParamName(component: any, name?: string): string {
    return mockGetUniqueParamName(component, name);
  }

  renameParam(component: any, param: any, name: string): void {
    mockRenameParam(component, param, name);
  }

  removeComponentQuery(component: any, query: any): void {
    mockRemoveComponentQuery(component, query);
  }

  removeComponentServerQuery(component: any, query: any): void {
    mockRemoveComponentServerQuery(component, query);
  }

  clearReferencesToRemovedQueries(removedQueries: string[] | string): void {
    mockClearReferencesToRemovedQueries(removedQueries);
  }
}
