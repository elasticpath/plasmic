import { getByContextAllProducts } from "@epcc-sdk/sdks-shopper";
import { createLogger } from "../utils/logger";
import type { buildEpClient } from "./ep-client";

const log = createLogger("productBatches");

/** Elastic Path accepts roughly 200 ids per `in(id,…)` filter. */
const BATCH_SIZE = 100;

export interface ProductBatch {
  rows: any[];
  included: any;
}

function batchIds(ids: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    batches.push(ids.slice(i, i + BATCH_SIZE));
  }
  return batches;
}

/**
 * Reads products by id, in as many requests as Elastic Path's filter length
 * allows, with each response's `included` block kept beside its rows so the
 * images can be joined per batch.
 *
 * A batch that fails contributes nothing rather than failing the read — one
 * unreachable product must not blank a whole bundle or listing.
 */
export async function readProductsByIds(
  client: ReturnType<typeof buildEpClient>,
  ids: string[]
): Promise<ProductBatch[]> {
  return Promise.all(
    batchIds(ids).map(async (batch) => {
      try {
        const response = await getByContextAllProducts({
          client,
          query: {
            filter: `in(id,${batch.join(",")})`,
            include: ["main_image", "files"],
            "page[limit]": batch.length,
          } as any,
        });
        if (response.error) {
          log.warn("Product batch read failed (non-fatal)", {
            requested: batch.length,
            status: response.response?.status,
          });
          return { rows: [], included: undefined };
        }
        return {
          rows: response.data?.data ?? [],
          included: response.data?.included,
        };
      } catch (err) {
        log.warn("Product batch read failed (non-fatal)", {
          requested: batch.length,
          error: err instanceof Error ? err.message : String(err),
        });
        return { rows: [], included: undefined };
      }
    })
  );
}
