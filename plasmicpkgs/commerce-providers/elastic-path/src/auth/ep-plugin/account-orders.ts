/** Order history of the selected organisation. */
import { getCustomerOrders } from "@epcc-sdk/sdks-shopper";
import type {
  EpAccountOrder,
  EpAccountOrderPageResult,
  EpAccountOrderResult,
} from "../../identity/operations";
import {
  EP_ACCOUNT_ORDER_PAGE_LIMIT_MAX,
  EP_ACCOUNT_ORDER_PAGE_OFFSET_MAX,
} from "../../identity/operations";
import { buildFixedTokenEpClient } from "../../ep-server-functions/fixed-token-ep-client";
import { toDecimal, type FormattedPrice } from "../../utils/price";
import { ACCOUNT_PAGE_LIMIT_MAX } from "./account-tokens";
import { EP_ACCOUNT_TOKEN_HEADER } from "./envelope";

/** Pages walked before an unfinished history is a failure, not a short list. */
export const ACCOUNT_ORDER_MAX_PAGES = 10;

const UNREACHABLE = "Elastic Path was unreachable.";
const REJECTED = "Elastic Path rejected the account-order read.";
const INCOMPLETE = "Elastic Path did not return the full order history.";

const ORDER_STATUSES = new Set([
  "complete",
  "incomplete",
  "cancelled",
  "processing",
]);

const ORDER_PAYMENTS = new Set([
  "authorized",
  "paid",
  "unpaid",
  "refunded",
  "partially_paid",
  "partially_authorized",
]);

const ORDER_SHIPPING = new Set(["unfulfilled", "fulfilled"]);

/**
 * Hyphenated UUID text. Case is ignored; the filter always uses the lowercase
 * form. Anything else is refused before it can be interpolated.
 */
const CANONICAL_ACCOUNT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AccountOrderReadError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AccountOrderReadError";
    this.status = status;
  }
}

/** Lowercase canonical UUID, or undefined when `value` is not one. */
export function canonicalAccountId(value: string): string | undefined {
  const trimmed = value.trim();
  if (!CANONICAL_ACCOUNT_ID.test(trimmed)) return undefined;
  return trimmed.toLowerCase();
}

function usableText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Owner id from `relationships.account.data.id`, lowercased.
 * `account.id` is not an owner. A non-UUID does not authorize the row.
 */
function accountDataId(row: Record<string, unknown>): string | undefined {
  const relationships = row.relationships;
  if (!relationships || typeof relationships !== "object") return undefined;
  const account = (relationships as { account?: unknown }).account;
  if (!account || typeof account !== "object") return undefined;
  const data = (account as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" ? canonicalAccountId(id) : undefined;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: Set<string>
): T | undefined {
  return typeof value === "string" && allowed.has(value)
    ? (value as T)
    : undefined;
}

function withTaxPrice(meta: unknown): FormattedPrice | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const display = (meta as { display_price?: unknown }).display_price;
  if (!display || typeof display !== "object") return undefined;
  const withTax = (display as { with_tax?: unknown }).with_tax;
  if (!withTax || typeof withTax !== "object") return undefined;
  const price = withTax as {
    amount?: unknown;
    currency?: unknown;
    formatted?: unknown;
  };
  if (typeof price.amount !== "number" || !Number.isFinite(price.amount)) {
    return undefined;
  }
  const currency = usableText(price.currency);
  const formatted = usableText(price.formatted);
  if (!currency || !formatted) return undefined;
  return {
    amount: price.amount,
    currency,
    formatted,
    float_price: toDecimal(price.amount, currency),
  };
}

function createdAt(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const timestamps = (meta as { timestamps?: unknown }).timestamps;
  if (!timestamps || typeof timestamps !== "object") return undefined;
  return usableText((timestamps as { created_at?: unknown }).created_at);
}

/** The order the browser may see, or null when the row is not one of this account. */
export function toAccountOrder(
  row: unknown,
  accountId: string
): EpAccountOrder | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const account = canonicalAccountId(accountId);
  const owner = accountDataId(record);
  if (!account || !owner || owner !== account) return null;
  const id = usableText(record.id);
  if (!id) return null;

  const order: EpAccountOrder = { id };
  const orderNumber = usableText(record.order_number);
  if (orderNumber) order.order_number = orderNumber;
  const status = enumValue<NonNullable<EpAccountOrder["status"]>>(
    record.status,
    ORDER_STATUSES
  );
  if (status) order.status = status;
  const payment = enumValue<NonNullable<EpAccountOrder["payment"]>>(
    record.payment,
    ORDER_PAYMENTS
  );
  if (payment) order.payment = payment;
  const shipping = enumValue<NonNullable<EpAccountOrder["shipping"]>>(
    record.shipping,
    ORDER_SHIPPING
  );
  if (shipping) order.shipping = shipping;
  const created = createdAt(record.meta);
  const withTax = withTaxPrice(record.meta);
  if (created || withTax) {
    const summary: NonNullable<EpAccountOrder["meta"]> = {};
    if (created) summary.timestamps = { created_at: created };
    if (withTax) summary.display_price = { with_tax: withTax };
    order.meta = summary;
  }
  return order;
}

/** A usable `meta.results.total` is a nonnegative integer. */
function reportedTotal(meta: unknown): number | undefined {
  const results =
    meta && typeof meta === "object"
      ? (meta as { results?: { total?: unknown } }).results
      : undefined;
  const reported =
    results && typeof results === "object" ? results.total : undefined;
  if (
    typeof reported !== "number" ||
    !Number.isInteger(reported) ||
    reported < 0
  ) {
    return undefined;
  }
  return reported;
}

/** One page of `getCustomerOrders`. The limit and offset are the caller's. */
async function loadAccountOrderPage(input: {
  client: ReturnType<typeof buildFixedTokenEpClient>;
  accountId: string;
  accountToken: string;
  limit: number;
  offset: number;
}): Promise<{ rows: unknown[]; meta: unknown }> {
  let result: Awaited<ReturnType<typeof getCustomerOrders>>;
  try {
    result = await getCustomerOrders({
      client: input.client,
      headers: {
        [EP_ACCOUNT_TOKEN_HEADER]: input.accountToken,
      } as NonNullable<
        NonNullable<Parameters<typeof getCustomerOrders>[0]>["headers"]
      >,
      query: {
        "page[limit]": input.limit,
        "page[offset]": input.offset,
        filter: `eq(account_id,${input.accountId})`,
      },
    });
  } catch {
    throw new AccountOrderReadError(502, UNREACHABLE);
  }

  if (!result.response) {
    throw new AccountOrderReadError(502, UNREACHABLE);
  }
  if (!result.response.ok) {
    throw new AccountOrderReadError(502, REJECTED);
  }

  const body = (result.data ?? {}) as { data?: unknown; meta?: unknown };
  if (!Array.isArray(body.data)) {
    throw new AccountOrderReadError(502, REJECTED);
  }
  return { rows: body.data, meta: body.meta };
}

export async function readAccountOrders(input: {
  host: string;
  clientId: string;
  implicitToken: string;
  accountId: string;
  accountToken: string;
}): Promise<EpAccountOrderResult> {
  const accountId = canonicalAccountId(input.accountId);
  if (!accountId) {
    throw new AccountOrderReadError(502, REJECTED);
  }

  const client = buildFixedTokenEpClient({
    host: input.host,
    clientId: input.clientId,
    token: input.implicitToken,
  });
  const orders: EpAccountOrder[] = [];
  let offset = 0;
  let rawRowsReceived = 0;
  let seenTotal: number | undefined;

  // Offset pages are separate reads, not one snapshot. A create or delete
  // between them can duplicate or skip a row without a detectable mismatch.
  // A total that disagrees with the rows in hand still fails the read.
  for (let page = 0; page < ACCOUNT_ORDER_MAX_PAGES; page++) {
    const { rows, meta } = await loadAccountOrderPage({
      client,
      accountId,
      accountToken: input.accountToken,
      limit: ACCOUNT_PAGE_LIMIT_MAX,
      offset,
    });
    const reported = reportedTotal(meta);
    if (reported !== undefined) seenTotal = reported;

    if (rows.length === 0) {
      if (seenTotal !== undefined && seenTotal !== rawRowsReceived) {
        throw new AccountOrderReadError(502, INCOMPLETE);
      }
      return { orders, total: orders.length };
    }

    rawRowsReceived += rows.length;
    for (const row of rows) {
      const order = toAccountOrder(row, accountId);
      if (order) orders.push(order);
    }

    if (seenTotal !== undefined) {
      if (seenTotal < rawRowsReceived) {
        throw new AccountOrderReadError(502, INCOMPLETE);
      }
      if (rawRowsReceived >= seenTotal) {
        return { orders, total: orders.length };
      }
    } else if (rows.length < ACCOUNT_PAGE_LIMIT_MAX) {
      return { orders, total: orders.length };
    }

    offset += ACCOUNT_PAGE_LIMIT_MAX;
  }

  throw new AccountOrderReadError(502, INCOMPLETE);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** Exactly `{ limit, offset }`, or a reason to refuse before Elastic Path. */
export function parseAccountOrderPageBody(
  body: unknown
):
  | { ok: true; limit: number; offset: number }
  | { ok: false; message: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Body must be an object." };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2 ||
    !Object.prototype.hasOwnProperty.call(record, "limit") ||
    !Object.prototype.hasOwnProperty.call(record, "offset")
  ) {
    return {
      ok: false,
      message: "Body must include only limit and offset.",
    };
  }
  if (!isInteger(record.limit)) {
    return { ok: false, message: "limit must be an integer." };
  }
  if (
    record.limit < 1 ||
    record.limit > EP_ACCOUNT_ORDER_PAGE_LIMIT_MAX
  ) {
    return { ok: false, message: "limit must be from 1 to 100." };
  }
  if (!isInteger(record.offset)) {
    return { ok: false, message: "offset must be an integer." };
  }
  if (record.offset < 0 || record.offset > EP_ACCOUNT_ORDER_PAGE_OFFSET_MAX) {
    return { ok: false, message: "offset must be from 0 to 100000." };
  }
  return { ok: true, limit: record.limit, offset: record.offset };
}

/**
 * One raw window. Rows that fail the ownership check are dropped. The next
 * window starts at `offset + limit`, not at the number of rows kept.
 */
export async function readAccountOrderPage(input: {
  host: string;
  clientId: string;
  implicitToken: string;
  accountId: string;
  accountToken: string;
  limit: number;
  offset: number;
}): Promise<EpAccountOrderPageResult> {
  const accountId = canonicalAccountId(input.accountId);
  if (!accountId) {
    throw new AccountOrderReadError(502, REJECTED);
  }

  const client = buildFixedTokenEpClient({
    host: input.host,
    clientId: input.clientId,
    token: input.implicitToken,
  });
  const { rows, meta } = await loadAccountOrderPage({
    client,
    accountId,
    accountToken: input.accountToken,
    limit: input.limit,
    offset: input.offset,
  });

  if (rows.length > input.limit) {
    throw new AccountOrderReadError(502, INCOMPLETE);
  }

  const reported = reportedTotal(meta);
  if (reported !== undefined) {
    const pastEnd = input.offset >= reported;
    if (rows.length === 0 && reported > input.offset) {
      throw new AccountOrderReadError(502, INCOMPLETE);
    }
    if (rows.length > 0 && pastEnd) {
      throw new AccountOrderReadError(502, INCOMPLETE);
    }
    if (input.offset + rows.length > reported) {
      throw new AccountOrderReadError(502, INCOMPLETE);
    }
  }

  const orders: EpAccountOrder[] = [];
  for (const row of rows) {
    const order = toAccountOrder(row, accountId);
    if (order) orders.push(order);
  }

  const nextOffset = input.offset + input.limit;
  let hasNextPage = false;
  if (nextOffset <= EP_ACCOUNT_ORDER_PAGE_OFFSET_MAX) {
    hasNextPage =
      reported !== undefined
        ? input.offset + rows.length < reported
        : rows.length === input.limit;
  }

  return {
    orders,
    total: orders.length,
    page: {
      limit: input.limit,
      offset: input.offset,
      hasNextPage,
      hasPreviousPage: input.offset > 0,
    },
  };
}
