export function jsLiteral(value: any): string {
  return JSON.stringify(value);
}
export function toVarName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}
