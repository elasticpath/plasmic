export function substituteUrlParams(template: string, params: Record<string, string>) {
  let out = template;
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(`[${k}]`, encodeURIComponent(v));
  }
  return out;
}
export function getMatchingPagePathParams(
  _pagePath: string,
  _lookup: string
): Record<string, string> | false {
  return false;
}
