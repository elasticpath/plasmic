const emptyHeaders = {
  get: () => null,
  has: () => false,
  keys: () => [][Symbol.iterator](),
  values: () => [][Symbol.iterator](),
  entries: () => [][Symbol.iterator](),
  forEach: () => {},
  [Symbol.iterator]: () => [][Symbol.iterator](),
};

export function headers() {
  return emptyHeaders;
}
