/**
 * Mock for @/wab/shared/core/slots — SlotSelection class.
 */
export class SlotSelection {
  tpl: any;
  slotParam: any;
  constructor(opts: { tpl: any; slotParam: any }) {
    this.tpl = opts.tpl;
    this.slotParam = opts.slotParam;
  }
  toTplSlotSelection() { return this; }
  getTpl() { return this.tpl; }
}
