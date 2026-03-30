/**
 * Mock for @/wab/shared/core/rich-text-util
 */
export function isTagListContainer(tag: string): boolean {
  return ["ul", "ol", "li"].includes(tag);
}
