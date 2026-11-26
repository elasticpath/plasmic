/** One order of the selected organisation. */
import { getAnOrder } from "@epcc-sdk/sdks-shopper";
import type {
  EpAccountOrderAddress,
  EpAccountOrderContact,
  EpAccountOrderDetail,
  EpAccountOrderItem,
} from "../../identity/operations";
import { buildFixedTokenEpClient } from "../../ep-server-functions/fixed-token-ep-client";
import { toDecimal, type FormattedPrice } from "../../utils/price";
import {
  AccountOrderReadError,
  canonicalAccountId,
  toAccountOrder,
} from "./account-orders";
import { EP_ACCOUNT_TOKEN_HEADER } from "./envelope";

const UNREACHABLE = "Elastic Path was unreachable.";
const REJECTED = "Elastic Path rejected the account-order read.";
const NOT_FOUND = "That order could not be found.";

const ADDRESS_FIELDS = [
  "first_name",
  "last_name",
  "company_name",
  "line_1",
  "line_2",
  "line_3",
  "city",
  "county",
  "region",
  "postcode",
  "country",
] as const;

const SHIPPING_FIELDS = [...ADDRESS_FIELDS, "phone_number", "instructions"] as const;

function usableText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Exactly `{ id }`, and `id` is a canonical UUID. Anything else is refused. */
export function parseAccountOrderReadBody(
  body: unknown
): { ok: true; id: string } | { ok: false; message: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Body must be an object." };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 1 ||
    !Object.prototype.hasOwnProperty.call(record, "id")
  ) {
    return { ok: false, message: "Body must include only an order id." };
  }
  if (typeof record.id !== "string") {
    return { ok: false, message: "id must be a string." };
  }
  const id = canonicalAccountId(record.id);
  if (!id) {
    return { ok: false, message: "id must be a UUID." };
  }
  return { ok: true, id };
}

function copyStrings(
  source: unknown,
  fields: readonly string[]
): Record<string, string> | undefined {
  if (!source || typeof source !== "object") return undefined;
  const record = source as Record<string, unknown>;
  const copied: Record<string, string> = {};
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string") copied[field] = value;
  }
  return Object.keys(copied).length > 0 ? copied : undefined;
}

function toContact(value: unknown): EpAccountOrderContact | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const name = usableText(record.name);
  const email = usableText(record.email);
  if (!name && !email) return undefined;
  const contact: EpAccountOrderContact = {};
  if (name) contact.name = name;
  if (email) contact.email = email;
  return contact;
}

/**
 * A completed taxed price. Upstream `float_price` is ignored. A price missing
 * amount, currency, or formatted text is omitted rather than filled in.
 */
function taxedPrice(value: unknown): FormattedPrice | undefined {
  if (!value || typeof value !== "object") return undefined;
  const price = value as {
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

function toItem(row: unknown): EpAccountOrderItem | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const id = usableText(record.id);
  if (!id) return null;
  const item: EpAccountOrderItem = { id };
  const name = usableText(record.name);
  if (name) item.name = name;
  const sku = usableText(record.sku);
  if (sku) item.sku = sku;
  if (
    typeof record.quantity === "number" &&
    Number.isInteger(record.quantity) &&
    record.quantity >= 0
  ) {
    item.quantity = record.quantity;
  }
  const productId = usableText(record.product_id);
  if (productId) item.product_id = productId;

  const meta = record.meta;
  const display =
    meta && typeof meta === "object"
      ? (meta as { display_price?: unknown }).display_price
      : undefined;
  const withTax =
    display && typeof display === "object"
      ? (display as { with_tax?: unknown }).with_tax
      : undefined;
  if (withTax && typeof withTax === "object") {
    const taxed = withTax as { unit?: unknown; value?: unknown };
    const unit = taxedPrice(taxed.unit);
    const value = taxedPrice(taxed.value);
    if (unit || value) {
      item.meta = {
        display_price: {
          with_tax: {
            ...(unit ? { unit } : {}),
            ...(value ? { value } : {}),
          },
        },
      };
    }
  }
  return item;
}

/**
 * Ids named by `relationships.items.data`. An empty or absent list is an
 * itemless order. A present list whose entries are not usable ids is malformed.
 */
function relatedItemIds(
  record: Record<string, unknown>
): { kind: "none" } | { kind: "malformed" } | { kind: "present"; ids: string[] } {
  const relationships = record.relationships;
  if (!relationships || typeof relationships !== "object") return { kind: "none" };
  if (!Object.prototype.hasOwnProperty.call(relationships, "items")) {
    return { kind: "none" };
  }
  const items = (relationships as { items?: unknown }).items;
  if (items == null) return { kind: "none" };
  if (typeof items !== "object") return { kind: "malformed" };
  if (!Object.prototype.hasOwnProperty.call(items, "data")) return { kind: "none" };
  const data = (items as { data?: unknown }).data;
  if (data == null) return { kind: "none" };
  if (!Array.isArray(data)) return { kind: "malformed" };
  if (data.length === 0) return { kind: "none" };
  const ids: string[] = [];
  for (const entry of data) {
    const id =
      entry && typeof entry === "object"
        ? usableText((entry as { id?: unknown }).id)
        : undefined;
    if (!id) return { kind: "malformed" };
    ids.push(id);
  }
  return { kind: "present", ids };
}

function includedItems(
  body: { included?: unknown },
  record: Record<string, unknown>
): { rows: unknown[]; requiredIds: string[] } {
  const related = relatedItemIds(record);
  if (related.kind === "malformed") {
    throw new AccountOrderReadError(502, REJECTED);
  }
  const included = body.included;
  const items =
    included && typeof included === "object"
      ? (included as { items?: unknown }).items
      : undefined;
  if (related.kind === "present") {
    if (!Array.isArray(items) || items.length === 0) {
      throw new AccountOrderReadError(502, REJECTED);
    }
    return { rows: items, requiredIds: related.ids };
  }
  if (items === undefined) return { rows: [], requiredIds: [] };
  if (!Array.isArray(items)) {
    throw new AccountOrderReadError(502, REJECTED);
  }
  return { rows: items, requiredIds: [] };
}

export async function readAccountOrder(input: {
  host: string;
  clientId: string;
  implicitToken: string;
  accountId: string;
  accountToken: string;
  orderId: string;
}): Promise<EpAccountOrderDetail> {
  const accountId = canonicalAccountId(input.accountId);
  const orderId = canonicalAccountId(input.orderId);
  if (!accountId || !orderId) {
    throw new AccountOrderReadError(502, REJECTED);
  }

  const client = buildFixedTokenEpClient({
    host: input.host,
    clientId: input.clientId,
    token: input.implicitToken,
  });

  let result: Awaited<ReturnType<typeof getAnOrder>>;
  try {
    result = await getAnOrder({
      client,
      headers: {
        [EP_ACCOUNT_TOKEN_HEADER]: input.accountToken,
      },
      path: { orderID: orderId },
      query: { include: ["items"] },
    });
  } catch {
    throw new AccountOrderReadError(502, UNREACHABLE);
  }

  if (!result.response) {
    throw new AccountOrderReadError(502, UNREACHABLE);
  }
  if (result.response.status === 404) {
    throw new AccountOrderReadError(404, NOT_FOUND);
  }
  if (!result.response.ok) {
    throw new AccountOrderReadError(502, REJECTED);
  }

  const body = result.data;
  if (!body || typeof body !== "object") {
    throw new AccountOrderReadError(502, REJECTED);
  }
  const record = body.data;
  if (!record || typeof record !== "object") {
    throw new AccountOrderReadError(502, REJECTED);
  }

  const summary = toAccountOrder(record, accountId);
  if (!summary) {
    throw new AccountOrderReadError(404, NOT_FOUND);
  }

  const included = includedItems(body, record as Record<string, unknown>);
  const items: EpAccountOrderItem[] = [];
  for (const row of included.rows) {
    const item = toItem(row);
    if (item) items.push(item);
  }
  if (included.requiredIds.length > 0) {
    const present = new Set(items.map((item) => item.id));
    if (included.requiredIds.some((id) => !present.has(id))) {
      throw new AccountOrderReadError(502, REJECTED);
    }
  }

  const detail: EpAccountOrderDetail = { ...summary, items };
  const contact = toContact(
    (record as { contact?: unknown }).contact
  );
  if (contact) detail.contact = contact;
  const shipping = copyStrings(
    (record as { shipping_address?: unknown }).shipping_address,
    SHIPPING_FIELDS
  );
  if (shipping) detail.shipping_address = shipping as EpAccountOrderAddress;
  const billing = copyStrings(
    (record as { billing_address?: unknown }).billing_address,
    ADDRESS_FIELDS
  );
  if (billing) detail.billing_address = billing as EpAccountOrderAddress;
  return detail;
}
