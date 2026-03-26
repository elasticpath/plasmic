/**
 * Mock for @/wab/shared/UserError
 */
export class ComponentCycleUserError extends Error {
  constructor() { super("Component cycle detected"); }
}
export class NestedTplSlotsError extends Error {
  constructor() { super("Cannot nest TplSlots"); }
}
