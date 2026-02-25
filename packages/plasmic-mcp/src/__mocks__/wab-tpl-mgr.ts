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
 */

export const mockEnsureBaseVariantSetting = jest.fn();
export const mockEnsureBaseVariant = jest.fn();
export const mockRenameComponent = jest.fn((component: any, name: string) => {
  // Default behavior mirrors real TplMgr: update component.name
  component.name = name;
});
export const mockRemoveComponent = jest.fn();
export const mockCreateStyleVariant = jest.fn();
export const mockCreatePrivateStyleVariant = jest.fn();
export const mockCreateVariantGroup = jest.fn();
export const mockCreateVariant = jest.fn();

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
}
