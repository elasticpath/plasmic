/**
 * Mock for @/wab/shared/SlotUtils
 */
export function isSlot(param: any): boolean {
  return !!param?.tplSlot;
}

export function getSlotArgs(comp: any): any[] {
  const vs = comp?.vsettings?.[0];
  if (!vs) return [];
  const slotParams = (comp.component?.params ?? []).filter(
    (p: any) => p.tplSlot
  );
  return (vs.args ?? []).filter((arg: any) =>
    slotParams.some((p: any) => p === arg.param)
  );
}

export function getTplSlotDescendants(_node: any): any[] {
  return [];
}

export function getTplSlotForParam(_component: any, _param: any): any {
  return undefined;
}
