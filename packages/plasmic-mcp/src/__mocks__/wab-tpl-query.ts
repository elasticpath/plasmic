/**
 * Minimal mock for @/wab/shared/TplQuery
 *
 * Provides $$$ with basic realistic behavior so unit tests don't crash.
 * Real TplQuery behavior is verified in integration tests using real
 * model objects — matching Studio's own testing approach.
 */

import { vi } from "vitest";

// Exported spies so unit tests can verify calls were made
export const mockAppend = vi.fn();
export const mockPrepend = vi.fn();
export const mockInsertAt = vi.fn();
export const mockRemove = vi.fn();
export const mockDetach = vi.fn();
export const mockAfter = vi.fn();
export const mockBefore = vi.fn();

function detachFromParent(node: any): void {
  if (!node?.parent) return;
  const parent = node.parent;
  if (parent.children) {
    const idx = parent.children.indexOf(node);
    if (idx !== -1) parent.children.splice(idx, 1);
  }
  // TplComponent slot args
  for (const vs of parent.vsettings ?? []) {
    for (const arg of vs.args ?? []) {
      if (arg.expr?.tpl) {
        const idx = arg.expr.tpl.indexOf(node);
        if (idx !== -1) arg.expr.tpl.splice(idx, 1);
      }
    }
  }
  node.parent = null;
}

function resolveSlotArg(tplComp: any, slotName: string): any {
  const param = tplComp.component?.params?.find(
    (p: any) => p.variable?.name === slotName
  );
  if (!param) throw new Error(`Expected param ${slotName} to exist`);
  const vs = tplComp.vsettings?.[0];
  if (!vs) throw new Error("No base variant settings");
  if (!vs.args) vs.args = [];
  let arg = vs.args.find(
    (a: any) => a.param === param || a.param?.variable?.name === slotName
  );
  if (!arg) {
    arg = { _type: "Arg", param, expr: { _type: "RenderExpr", tpl: [] } };
    vs.args.push(arg);
  }
  if (!arg.expr?.tpl) arg.expr = { _type: "RenderExpr", tpl: [] };
  return arg;
}

function isSlotSelection(node: any): boolean {
  return node?._isSlotSelection === true;
}

function doInsert(parent: any, child: any, index: number): void {
  detachFromParent(child);
  if (isSlotSelection(parent)) {
    const arg = resolveSlotArg(parent.tpl, parent.slotParam.variable.name);
    if (index === -1) arg.expr.tpl.push(child);
    else arg.expr.tpl.splice(index, 0, child);
    child.parent = parent.tpl;
  } else if (parent?.component && parent?.vsettings) {
    // TplComponent — insert into "children" slot
    const arg = resolveSlotArg(parent, "children");
    if (index === -1) arg.expr.tpl.push(child);
    else arg.expr.tpl.splice(index, 0, child);
    child.parent = parent;
  } else {
    // TplTag
    if (!parent.children) parent.children = [];
    if (index === -1) parent.children.push(child);
    else parent.children.splice(index, 0, child);
    child.parent = parent;
  }
}

export class TplQuery {
  readonly nodes: any[];
  constructor(input: any) {
    if (Array.isArray(input)) this.nodes = input;
    else this.nodes = input != null ? [input] : [];
  }

  one() { return this.nodes[0]; }
  toArray() { return this.nodes; }
  toArrayOfTplNodes() { return this.nodes; }
  isEmpty() { return this.nodes.length === 0; }
  get(i: number) { return this.nodes[i]; }

  append(child: any) {
    mockAppend(this.nodes[0], child);
    doInsert(this.nodes[0], child, -1);
    return this;
  }
  prepend(child: any) {
    mockPrepend(this.nodes[0], child);
    doInsert(this.nodes[0], child, 0);
    return this;
  }
  insertAt(child: any, index: number) {
    mockInsertAt(this.nodes[0], child, index);
    doInsert(this.nodes[0], child, index);
    return this;
  }

  remove(opts?: any) {
    mockRemove(this.nodes[0], opts);
    detachFromParent(this.nodes[0]);
    return this;
  }
  tryRemove(opts?: any) {
    if (this.nodes[0]?.parent) detachFromParent(this.nodes[0]);
    return this;
  }
  detach() {
    mockDetach(this.nodes[0]);
    detachFromParent(this.nodes[0]);
    return this;
  }

  after(toInsert: any) {
    mockAfter(this.nodes[0], toInsert);
    const ref = this.nodes[0];
    detachFromParent(toInsert);
    if (ref?.parent?.children) {
      const idx = ref.parent.children.indexOf(ref);
      if (idx !== -1) {
        ref.parent.children.splice(idx + 1, 0, toInsert);
        toInsert.parent = ref.parent;
      }
    }
    return this;
  }
  before(toInsert: any) {
    mockBefore(this.nodes[0], toInsert);
    const ref = this.nodes[0];
    detachFromParent(toInsert);
    if (ref?.parent?.children) {
      const idx = ref.parent.children.indexOf(ref);
      if (idx !== -1) {
        ref.parent.children.splice(idx, 0, toInsert);
        toInsert.parent = ref.parent;
      }
    }
    return this;
  }

  slot(slotName: string) {
    const tplComp = this.nodes[0];
    const param = tplComp.component?.params?.find(
      (p: any) => p.variable?.name === slotName
    );
    if (!param) throw new Error(`Expected param ${slotName} to exist`);
    return new TplQuery({
      _isSlotSelection: true,
      tpl: tplComp,
      slotParam: param,
      toTplSlotSelection() { return this; },
      getTpl() { return tplComp; },
    });
  }

  param(paramName: string) {
    const tplComp = this.nodes[0];
    return tplComp.component?.params?.find(
      (p: any) => p.variable?.name === paramName
    );
  }

  setSlotArg(argName: string, expr: any) {
    const tplComp = this.nodes[0];
    const arg = resolveSlotArg(tplComp, argName);
    arg.expr = expr;
    if (expr?.tpl) {
      for (const child of expr.tpl) child.parent = tplComp;
    }
    return this;
  }

  getSlotArg(argName: string) {
    const tplComp = this.nodes[0];
    const vs = tplComp.vsettings?.[0];
    if (!vs) return undefined;
    return (vs.args ?? []).find(
      (a: any) => a.param?.variable?.name === argName
    );
  }

  tryGetOwningComponent() {
    let node = this.nodes[0];
    while (node) {
      if (node._ownerComponent) return node._ownerComponent;
      node = node.parent;
    }
    return undefined;
  }

  parents() {
    const result: any[] = [];
    let node = this.nodes[0]?.parent;
    while (node) { result.push(node); node = node.parent; }
    return new TplQuery(result);
  }

  children() {
    const node = this.nodes[0];
    return new TplQuery(node?.children ?? []);
  }
  childrenOnly() { return this.children(); }
  getTplComponent() { return this.nodes[0]; }
  getTplTag() { return this.nodes[0]; }
  getBaseArgs() { return this.nodes[0]?.vsettings?.[0]?.args ?? []; }

  tryGetArgContainingTpl(node: any) {
    const tplComp = this.nodes[0];
    for (const vs of tplComp.vsettings ?? []) {
      for (const arg of vs.args ?? []) {
        if (arg.expr?.tpl?.includes(node)) return arg;
      }
    }
    return undefined;
  }

  updateSlotArg(argName: string, func: any, opts: any) {
    const param = this.param(argName);
    const arg = this.getSlotArg(argName) ?? {
      _type: "Arg", param, expr: { _type: "RenderExpr", tpl: [] },
    };
    const spec = func(arg);
    spec.updateArg();
    if (!this.getSlotArg(argName)) {
      this.getBaseArgs().push(arg);
    }
    // Set parent pointers
    if (arg.expr?.tpl) {
      for (const child of arg.expr.tpl) child.parent = this.nodes[0];
    }
    return this;
  }

  updateSlotArgForParam(param: any, func: any, opts: any) {
    return this.updateSlotArg(param.variable.name, func, opts);
  }
}

export function $$$(input: any): TplQuery {
  return new TplQuery(input);
}

export class ComponentCycleUserError extends Error {
  constructor() { super("Component cycle detected"); }
}
export class NestedTplSlotsError extends Error {
  constructor() { super("Cannot nest TplSlots"); }
}
