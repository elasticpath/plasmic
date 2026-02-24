/**
 * Mock for @/wab/shared/TplMgr
 */

export const mockEnsureBaseVariantSetting = jest.fn();
export const mockEnsureBaseVariant = jest.fn();

export class TplMgr {
  constructor(_args: { site: any }) {}

  ensureBaseVariantSetting(tpl: any): any {
    return mockEnsureBaseVariantSetting(tpl);
  }

  ensureBaseVariant(comp: any): any {
    return mockEnsureBaseVariant(comp);
  }
}
