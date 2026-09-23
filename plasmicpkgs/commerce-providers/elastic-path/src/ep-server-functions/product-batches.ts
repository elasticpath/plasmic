/** Elastic Path accepts roughly 200 ids per `in(id,…)` filter. */
const BATCH_SIZE = 100;

export function batchProductIds(ids: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    batches.push(ids.slice(i, i + BATCH_SIZE));
  }
  return batches;
}
