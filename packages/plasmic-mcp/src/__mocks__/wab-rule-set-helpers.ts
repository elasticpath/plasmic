/**
 * Mock for @/wab/shared/RuleSetHelpers
 */

export class RuleSetHelpers {
  private _rs: any;
  constructor(rs: any, _forTag: string) {
    this._rs = rs;
  }
  has(prop: string): boolean {
    return prop in (this._rs?.values ?? {});
  }
  get(prop: string): string {
    return this._rs?.values?.[prop] ?? "";
  }
  getRaw(prop: string): string | undefined {
    return this._rs?.values?.[prop];
  }
  set(prop: string, val: string): void {
    if (!this._rs.values) this._rs.values = {};
    this._rs.values[prop] = val;
  }
  clear(prop: string): void {
    if (this._rs?.values) delete this._rs.values[prop];
  }
  clearAll(props: string[]): void {
    for (const p of props) this.clear(p);
  }
  merge(props: Record<string, string>): void {
    for (const [k, v] of Object.entries(props)) this.set(k, v);
  }
  props(): string[] {
    return Object.keys(this._rs?.values ?? {});
  }
}

export function RSH(rs: any, tpl: any): RuleSetHelpers {
  const forTag = tpl?.tag ?? "div";
  return new RuleSetHelpers(rs, forTag);
}
