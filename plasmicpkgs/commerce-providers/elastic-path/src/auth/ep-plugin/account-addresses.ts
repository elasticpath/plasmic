/**
 * Saved addresses of the selected organisation.
 *
 * The browser names this operation and nothing else. The account id and the
 * account-management token come from the selected session slot, and the
 * implicit bearer rides on the fixed-token shopper client.
 */
import { getV2AccountAddresses } from "@epcc-sdk/sdks-shopper";
import type { EpAccountAddress } from "../../identity/operations";
import { buildFixedTokenEpClient } from "../../ep-server-functions/fixed-token-ep-client";
import { ACCOUNT_PAGE_LIMIT_MAX } from "./account-tokens";
import { EP_ACCOUNT_TOKEN_HEADER } from "./envelope";

/** Pages walked before an unfinished collection is a failure, not a short list. */
export const ACCOUNT_ADDRESS_MAX_PAGES = 10;

const ADDRESS_FIELDS = [
  "name",
  "first_name",
  "last_name",
  "company_name",
  "phone_number",
  "instructions",
  "line_1",
  "line_2",
  "city",
  "county",
  "region",
  "postcode",
  "country",
] as const;

const UNREACHABLE = "Elastic Path was unreachable.";
const REJECTED = "Elastic Path rejected the account-address read.";
const INCOMPLETE = "Elastic Path did not return the full address list.";

export class AccountAddressReadError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AccountAddressReadError";
    this.status = status;
  }
}

function explicitAccountId(row: Record<string, unknown>): string | undefined {
  const relationships = row.relationships;
  if (!relationships || typeof relationships !== "object") return undefined;
  const account = (relationships as { account?: unknown }).account;
  if (!account || typeof account !== "object") return undefined;
  const direct = (account as { id?: unknown }).id;
  if (typeof direct === "string" && direct) return direct;
  const nested = (account as { data?: { id?: unknown } }).data?.id;
  return typeof nested === "string" && nested ? nested : undefined;
}

/** The address the browser may see, or null when the row is not one. */
export function toAccountAddress(
  row: unknown,
  accountId: string
): EpAccountAddress | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const owner = explicitAccountId(record);
  if (owner !== undefined && owner !== accountId) return null;
  if (typeof record.id !== "string" || !record.id) return null;

  const address: EpAccountAddress = { id: record.id };
  for (const field of ADDRESS_FIELDS) {
    const value = record[field];
    if (typeof value === "string") address[field] = value;
  }
  return address;
}

function resultTotal(meta: unknown, rawCount: number): number {
  const results =
    meta && typeof meta === "object"
      ? (meta as { results?: { total?: unknown } }).results
      : undefined;
  const reported =
    results && typeof results === "object" ? results.total : undefined;
  return typeof reported === "number" && Number.isFinite(reported)
    ? reported
    : rawCount;
}

export async function readAccountAddresses(input: {
  host: string;
  clientId: string;
  implicitToken: string;
  accountId: string;
  accountToken: string;
}): Promise<{ addresses: EpAccountAddress[]; total: number }> {
  const client = buildFixedTokenEpClient({
    host: input.host,
    clientId: input.clientId,
    token: input.implicitToken,
  });
  const addresses: EpAccountAddress[] = [];
  let offset = 0;

  for (let page = 0; ; page++) {
    let result: Awaited<ReturnType<typeof getV2AccountAddresses>>;
    try {
      result = await getV2AccountAddresses({
        client,
        path: { accountID: input.accountId },
        headers: { [EP_ACCOUNT_TOKEN_HEADER]: input.accountToken },
        query: {
          "page[limit]": ACCOUNT_PAGE_LIMIT_MAX,
          "page[offset]": offset,
        },
      });
    } catch {
      throw new AccountAddressReadError(502, UNREACHABLE);
    }

    if (!result.response) {
      throw new AccountAddressReadError(502, UNREACHABLE);
    }
    if (!result.response.ok) {
      throw new AccountAddressReadError(
        result.response.status || 502,
        REJECTED
      );
    }

    const body = (result.data ?? {}) as {
      data?: unknown;
      meta?: unknown;
    };
    const rows = Array.isArray(body.data) ? body.data : [];
    for (const row of rows) {
      const address = toAccountAddress(row, input.accountId);
      if (address) addresses.push(address);
    }

    if (rows.length === 0) {
      return { addresses, total: addresses.length };
    }
    offset += ACCOUNT_PAGE_LIMIT_MAX;
    if (offset >= resultTotal(body.meta, rows.length)) {
      return { addresses, total: addresses.length };
    }
    if (page === ACCOUNT_ADDRESS_MAX_PAGES - 1) {
      throw new AccountAddressReadError(502, INCOMPLETE);
    }
  }
}
