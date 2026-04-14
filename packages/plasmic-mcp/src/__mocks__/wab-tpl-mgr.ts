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

export const mockEnsureBaseVariantSetting = vi.fn((tpl: any) => {
  // Default behavior: return the first variant setting (base variant), creating it if needed
  if (!tpl.vsettings || tpl.vsettings.length === 0) {
    tpl.vsettings = [{ variants: [], attrs: {}, rs: { values: {} } }];
  }
  return tpl.vsettings[0];
});
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
export const mockAddMixin = vi.fn((_name?: string) => {
  return { _type: "Mixin", name: _name ?? "Unnamed Mixin", uuid: "mock-mixin-uuid", rs: { values: {}, mixins: [] }, forTheme: false, variantedRs: [] };
});
export const mockRemoveMixin = vi.fn();
export const mockRenameMixin = vi.fn((mixin: any, name: string) => {
  mixin.name = name;
});
export const mockDuplicateMixin = vi.fn((mixin: any) => {
  return { ...mixin, uuid: "dup-mixin-uuid", name: mixin.name + " (copy)" };
});
export const mockAddAnimationSequence = vi.fn((_name?: string) => {
  return {
    _type: "AnimationSequence", name: _name ?? "Unnamed Animation",
    uuid: "mock-anim-seq-uuid", keyframes: [],
  };
});
export const mockRemoveAnimationSequence = vi.fn();
export const mockRenameAnimationSequence = vi.fn((seq: any, name: string) => {
  seq.name = name;
});
export const mockDuplicateAnimationSequence = vi.fn((seq: any) => {
  return { ...seq, uuid: "dup-anim-seq-uuid", name: seq.name + " (copy)", keyframes: [...seq.keyframes] };
});
export const mockAddAnimation = vi.fn((
  sequence: any,
  duration = "1s",
  delay = "0s",
  timingFunction = "ease",
  iterationCount = "1",
  direction = "normal",
  fillMode = "none",
  playState = "running",
) => {
  return {
    _type: "Animation", sequence, duration, delay, timingFunction,
    iterationCount, direction, fillMode, playState,
  };
});
export const mockGetTplComponentArg = vi.fn((tpl: any, vs: any, argVar: any) => {
  return (vs.args ?? []).find((a: any) => a.param?.variable === argVar);
});
export const mockSetTplComponentArg = vi.fn((tpl: any, vs: any, argVar: any, expr: any) => {
  if (!vs.args) vs.args = [];
  const existing = vs.args.find((a: any) => a.param?.variable === argVar);
  if (existing) {
    existing.expr = expr;
  } else {
    const param = (tpl.component?.params ?? []).find((p: any) => p.variable === argVar);
    vs.args.push({ param: param ?? { variable: argVar }, expr });
  }
});
export const getTplComponentArg = (...args: any[]) => mockGetTplComponentArg(...args);
export const setTplComponentArg = (...args: any[]) => mockSetTplComponentArg(...args);
export const mockReorderChildren = vi.fn();
export const mockConvertComponentToPage = vi.fn();
export const mockConvertPageToComponent = vi.fn();
export const mockChangePagePath = vi.fn();
export const mockAddDataToken = vi.fn((opts: any) => {
  return { _type: "DataToken", name: opts?.name ?? "Unnamed Data Token", type: "Data", value: opts?.value ?? "null", uuid: "mock-data-token-uuid", variantedValues: [], isRegistered: false, regKey: undefined };
});
export const mockRenameDataToken = vi.fn();
export const mockDuplicateDataToken = vi.fn((token: any) => {
  return { ...token, uuid: "dup-data-token-uuid", name: token.name + " (copy)" };
});
export const mockCreateGlobalVariantGroup = vi.fn((_name?: string) => {
  return {
    _type: "GlobalVariantGroup", uuid: "mock-gvg-uuid",
    param: { variable: { name: _name ?? "Unnamed Global Variant Group" } },
    variants: [], multi: false, type: "global-user-defined",
  };
});
export const mockCreateGlobalVariant = vi.fn((_group: any, _name?: string) => {
  return { _type: "Variant", uuid: "mock-global-variant-uuid", name: _name ?? "Unnamed Variant", parent: _group, mediaQuery: null };
});
export const mockCreateScreenVariant = vi.fn((_opts: any) => {
  const query = _opts?.spec?.query?.() ?? "(min-width:768px)";
  return { _type: "Variant", uuid: "mock-screen-variant-uuid", name: _opts?.name ?? "Screen", parent: null, mediaQuery: query };
});
export const mockRemoveGlobalVariantGroup = vi.fn();
export const mockUpdateScreenVariantQuery = vi.fn((variant: any, query: string) => {
  variant.mediaQuery = query;
});
export const mockRenameVariant = vi.fn((variant: any, name: string) => {
  variant.name = name;
});
export const mockRenameVariantGroup = vi.fn((group: any, name: string) => {
  if (group.param?.variable) group.param.variable.name = name;
});
export const mockRemoveSplit = vi.fn();
export const mockAddImageAsset = vi.fn((opts: any) => {
  return {
    _type: "ImageAsset", uuid: "mock-image-asset-uuid",
    name: opts?.name ?? "Unnamed Image", type: opts?.type ?? "picture",
    dataUri: opts?.dataUri ?? null, width: opts?.width ?? null,
    height: opts?.height ?? null, aspectRatio: opts?.aspectRatio ?? null,
  };
});
export const mockRenameImageAsset = vi.fn((asset: any, name: string) => {
  asset.name = name;
});
export const mockRemoveImageAsset = vi.fn();
export const mockAttachComponent = vi.fn();
export const mockGetUniqueComponentName = vi.fn(
  (_name?: string) => _name ?? "Unnamed Component"
);
export const mockCanExtractComponent = vi.fn((_tpl: any) => true);
export const mockRemoveState = vi.fn();
export const mockTryRemoveVariant = vi.fn();
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

  createStyleVariant(component: any, selectors?: string[]): [any, boolean] {
    return [mockCreateStyleVariant(component, selectors), true];
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

  reorderChildren(tpl: any, reorderedChildren: any[]): void {
    mockReorderChildren(tpl, reorderedChildren);
  }

  convertComponentToPage(component: any): void {
    mockConvertComponentToPage(component);
  }

  convertPageToComponent(component: any): void {
    mockConvertPageToComponent(component);
  }

  changePagePath(page: any, path: string): void {
    mockChangePagePath(page, path);
  }

  addDataToken(opts: any): any {
    return mockAddDataToken(opts);
  }

  renameDataToken(projectId: string, token: any, name: string): void {
    mockRenameDataToken(projectId, token, name);
  }

  duplicateDataToken(token: any): any {
    return mockDuplicateDataToken(token);
  }

  createGlobalVariantGroup(name?: string): any {
    return mockCreateGlobalVariantGroup(name);
  }

  createGlobalVariant(group: any, name?: string, extra?: any): any {
    return mockCreateGlobalVariant(group, name, extra);
  }

  createScreenVariant(opts: any): any {
    return mockCreateScreenVariant(opts);
  }

  removeGlobalVariantGroup(group: any): void {
    mockRemoveGlobalVariantGroup(group);
  }

  updateScreenVariantQuery(variant: any, query: string): void {
    mockUpdateScreenVariantQuery(variant, query);
  }

  renameVariant(variant: any, name?: string): void {
    mockRenameVariant(variant, name);
  }

  renameVariantGroup(group: any, name?: string): void {
    mockRenameVariantGroup(group, name);
  }

  removeSplit(split: any): void {
    mockRemoveSplit(split);
  }

  addImageAsset(opts: any): any {
    return mockAddImageAsset(opts);
  }

  renameImageAsset(asset: any, name: string): void {
    mockRenameImageAsset(asset, name);
  }

  removeImageAsset(asset: any): void {
    mockRemoveImageAsset(asset);
  }

  attachComponent(component: any, originalComponent?: any, originalComponentSite?: any): void {
    mockAttachComponent(component, originalComponent, originalComponentSite);
  }

  getUniqueComponentName(name?: string): string {
    return mockGetUniqueComponentName(name);
  }

  canExtractComponent(tpl: any): boolean {
    return mockCanExtractComponent(tpl);
  }

  removeState(component: any, state: any): void {
    mockRemoveState(component, state);
  }

  tryRemoveVariant(variant: any, component: any): void {
    mockTryRemoveVariant(variant, component);
  }

  addMixin(name?: string, mixin?: any): any {
    return mockAddMixin(name, mixin);
  }

  removeMixin(mixin: any): void {
    mockRemoveMixin(mixin);
  }

  renameMixin(mixin: any, name: string): void {
    mockRenameMixin(mixin, name);
  }

  duplicateMixin(mixin: any): any {
    return mockDuplicateMixin(mixin);
  }

  addAnimationSequence(name?: string, animationSequence?: any): any {
    return mockAddAnimationSequence(name, animationSequence);
  }

  removeAnimationSequence(sequence: any): void {
    mockRemoveAnimationSequence(sequence);
  }

  renameAnimationSequence(sequence: any, name: string): void {
    mockRenameAnimationSequence(sequence, name);
  }

  duplicateAnimationSequence(sequence: any): any {
    return mockDuplicateAnimationSequence(sequence);
  }

  addAnimation(
    sequence: any,
    duration?: string,
    delay?: string,
    timingFunction?: string,
    iterationCount?: string,
    direction?: string,
    fillMode?: string,
    playState?: string,
  ): any {
    return mockAddAnimation(sequence, duration, delay, timingFunction, iterationCount, direction, fillMode, playState);
  }
}
