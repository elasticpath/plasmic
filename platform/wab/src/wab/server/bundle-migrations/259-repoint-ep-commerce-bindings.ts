/**
 * @elasticpath/plasmic-ep-commerce-elastic-path 0.4.0 publishes Elastic Path's
 * own product and cart response shapes instead of the Shopify-lineage
 * normalization it inherited from @plasmicpkgs/commerce (ADR-0002), so every
 * saved binding that reached into the old shape points at nothing.
 *
 * This repoints the deterministic renames. Paths whose replacement needs a
 * judgement call — `price.value`, `path`, `$ctx.cartData` — are left alone and
 * collected into a worklist logged at the end of the run.
 *
 * A binding is a plain `code` string on a CustomCode or a `path` array on an
 * ObjectPath, so this reads the bundle directly rather than unbundling it. That
 * keeps a project the bundler would reject — an ObjectPath in
 * `PageMeta.openGraphImage`, which the model schema does not allow — loadable.
 */
import { BundledMigrationFn } from "@/wab/server/db/BundleMigrator";
import { BundleMigrationType } from "@/wab/server/db/bundle-migration-utils";
import { logger } from "@/wab/server/observability";
import { BundledInst, UnsafeBundle } from "@/wab/shared/bundles";

type PathSegment = string | number;

interface RewriteRule {
  /** The `$ctx` key the chain is rooted on. */
  receiver: string;
  /** Segments after the receiver that identify the old path. */
  was: string[];
  /** Segments that replace them. */
  now: string[];
  /**
   * Segment names that, read off the rewritten path, are themselves old-shape.
   * A rename that lands on a string has none; one that lands on a collection or
   * a money object has whichever of its own fields 0.4.0 moved.
   */
  suspectTail?: string[];
  /**
   * Advice to report whatever the tail is, for a rename that lands on a value
   * of a different type than the one it replaces.
   */
  alwaysReport?: string;
}

interface ManualRule {
  receiver: string;
  /** Empty means the whole receiver is gone, whatever is read off it. */
  was: string[];
  advice: string;
}

/** Product fields whose path moved, for spotting them behind an index. */
const PRODUCT_LEAVES = [
  "name",
  "description",
  "sku",
  "slug",
  "price",
  "path",
  "options",
  "variants",
  "extensions",
  "_highlightedName",
  "_highlightedDescription",
  "_snippetedDescription",
];
const VARIATION_LEAVES = ["displayName", "values", "label", "hexColors"];
const CART_ITEM_LEAVES = ["imageUrl", "variantId", "price", "currencyCode"];
/**
 * A cart total was a bare number in minor units; it is now Elastic Path's money
 * object. Repointing lands on the right thing but cannot fix an expression that
 * divided or formatted the number itself.
 */
const MONEY_ADVICE =
  "was a number in minor units, now a money object — read `.formatted` and drop any division or toFixed";

const REWRITE_RULES: RewriteRule[] = [
  { receiver: "currentProduct", was: ["name"], now: ["attributes", "name"] },
  {
    receiver: "currentProduct",
    was: ["description"],
    now: ["attributes", "description"],
  },
  { receiver: "currentProduct", was: ["sku"], now: ["attributes", "sku"] },
  { receiver: "currentProduct", was: ["slug"], now: ["attributes", "slug"] },
  {
    receiver: "currentProduct",
    was: ["price", "formatted"],
    now: ["meta", "display_price", "without_tax", "formatted"],
  },
  {
    receiver: "currentProduct",
    was: ["price", "currencyCode"],
    now: ["meta", "display_price", "without_tax", "currency"],
  },
  {
    receiver: "currentProduct",
    was: ["options"],
    now: ["variations"],
    suspectTail: VARIATION_LEAVES,
  },
  {
    receiver: "currentProduct",
    was: ["variants"],
    now: ["childProducts"],
    suspectTail: PRODUCT_LEAVES,
  },
  {
    receiver: "cart",
    was: ["lineItems"],
    now: ["items"],
    suspectTail: CART_ITEM_LEAVES,
  },
  {
    receiver: "cart",
    was: ["subtotalPrice"],
    now: ["meta", "display_price", "without_tax"],
    alwaysReport: MONEY_ADVICE,
  },
  {
    receiver: "cart",
    was: ["totalPrice"],
    now: ["meta", "display_price", "with_tax"],
    alwaysReport: MONEY_ADVICE,
  },
  {
    receiver: "cart",
    was: ["currency", "code"],
    now: ["meta", "display_price", "without_tax", "currency"],
  },
  { receiver: "currentCartItem", was: ["imageUrl"], now: ["image", "href"] },
  { receiver: "currentVariationOption", was: ["label"], now: ["name"] },
];

/**
 * Fields the old normalization invented or derived, with no single Elastic Path
 * path to point at. Elastic Path's own API documentation is the reference now,
 * so say that rather than guess.
 */
function removedLeaves(receiver: string, leaves: string[]): ManualRule[] {
  return leaves.map((leaf) => ({
    receiver,
    was: [leaf],
    advice:
      "not on the Elastic Path shape — see Elastic Path's API documentation for the field that replaces it",
  }));
}

const MANUAL_RULES: ManualRule[] = [
  {
    receiver: "currentProduct",
    was: ["price", "value"],
    advice:
      "meta.display_price.without_tax.formatted, dropping the surrounding currency arithmetic",
  },
  {
    receiver: "currentProduct",
    was: ["price"],
    advice: "meta.display_price.without_tax",
  },
  {
    receiver: "currentProduct",
    was: ["path"],
    advice: "build the href from attributes.slug",
  },
  {
    receiver: "currentProduct",
    was: ["_highlightedName"],
    advice: "$ctx.currentHit.highlightedName",
  },
  {
    receiver: "currentProduct",
    was: ["_highlightedDescription"],
    advice: "$ctx.currentHit.highlightedDescription",
  },
  {
    receiver: "currentProduct",
    was: ["_snippetedDescription"],
    advice: "$ctx.currentHit.snippetedDescription",
  },
  { receiver: "currentProduct", was: ["_score"], advice: "$ctx.currentHit.score" },
  {
    receiver: "currentProduct",
    was: ["extensions"],
    advice:
      "attributes.extensions, Elastic Path's own wire path, or the $ctx.productExtensions context",
  },
  { receiver: "cart", was: ["currency"], advice: "cart.meta.display_price" },
  {
    receiver: "currentVariationOption",
    was: ["hexColors"],
    advice:
      "removed \u2014 Elastic Path has no colour on a variation option; source it yourself",
  },
  {
    receiver: "currentCartItem",
    was: ["variantId"],
    advice: "product_id, which is the value it always held",
  },
  { receiver: "cartData", was: [], advice: "$ctx.cart" },
  { receiver: "checkoutCartData", was: [], advice: "$ctx.cart" },
  ...removedLeaves("currentProduct", ["rawData", "availableForSale"]),
  ...removedLeaves("cart", [
    "lineItemsSubtotalPrice",
    "taxesIncluded",
    "createdAt",
    "customerId",
    "email",
    "url",
  ]),
  ...removedLeaves("currentCartItem", [
    "formattedPrice",
    "formattedListPrice",
    "formattedLineTotal",
    "optionValues",
    "locationSlug",
    "productId",
    "price",
    "listPrice",
    "lineTotal",
    "path",
    "variant",
  ]),
];

export interface ManualFinding {
  component: string;
  expr: "CustomCode" | "ObjectPath";
  was: string;
  advice: string;
}

const isIdentChar = (c: string | undefined) =>
  !!c && /[A-Za-z0-9_$]/.test(c);

const skipWs = (code: string, i: number) => {
  while (i < code.length && /\s/.test(code[i])) {
    i++;
  }
  return i;
};

/**
 * Positions of `$ctx` tokens that are really code, skipping string literals,
 * comments, and the literal spans of template literals — but recursing into
 * template-literal `${}` interpolations, which are code again.
 */
function findCtxTokens(code: string, from: number, to: number, out: number[]) {
  let i = from;
  while (i < to) {
    const c = code[i];
    if (c === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i);
      i = nl === -1 || nl > to ? to : nl + 1;
    } else if (c === "/" && code[i + 1] === "*") {
      const close = code.indexOf("*/", i + 2);
      i = close === -1 || close > to ? to : close + 2;
    } else if (c === '"' || c === "'") {
      i = skipQuoted(code, i, to);
    } else if (c === "`") {
      i = skipTemplate(code, i, to, out);
    } else if (
      c === "$" &&
      code.startsWith("$ctx", i) &&
      !isIdentChar(code[i - 1]) &&
      code[i - 1] !== "." &&
      !isIdentChar(code[i + 4])
    ) {
      out.push(i);
      i += 4;
    } else {
      i++;
    }
  }
}

function skipQuoted(code: string, i: number, to: number) {
  const quote = code[i];
  i++;
  while (i < to) {
    if (code[i] === "\\") {
      i += 2;
    } else if (code[i] === quote) {
      return i + 1;
    } else {
      i++;
    }
  }
  return to;
}

function skipTemplate(code: string, i: number, to: number, out: number[]) {
  i++;
  while (i < to) {
    if (code[i] === "\\") {
      i += 2;
    } else if (code[i] === "`") {
      return i + 1;
    } else if (code[i] === "$" && code[i + 1] === "{") {
      const close = findInterpolationEnd(code, i + 2, to);
      findCtxTokens(code, i + 2, close, out);
      i = close + 1;
    } else {
      i++;
    }
  }
  return to;
}

/** Index of the `}` closing a template interpolation opened before `from`. */
function findInterpolationEnd(code: string, from: number, to: number) {
  let i = from;
  let depth = 0;
  while (i < to) {
    const c = code[i];
    if (c === '"' || c === "'") {
      i = skipQuoted(code, i, to);
    } else if (c === "`") {
      i = skipTemplate(code, i, to, []);
    } else if (c === "{") {
      depth++;
      i++;
    } else if (c === "}") {
      if (depth === 0) {
        return i;
      }
      depth--;
      i++;
    } else {
      i++;
    }
  }
  return to;
}

interface Accessor {
  name: PathSegment;
  /** Start of the accessor, including its `.`, `?.` or `[`. */
  start: number;
  end: number;
  optional: boolean;
}

/**
 * Reads the member-access chain that follows a root token. Stops at anything it
 * cannot resolve to a literal segment — a call, a computed index, an operator —
 * so a chain is only ever rewritten up to the part we actually understand.
 */
function parseAccessors(code: string, from: number): Accessor[] {
  const accessors: Accessor[] = [];
  let i = from;
  for (;;) {
    const start = skipWs(code, i);
    let cursor = start;
    let optional = false;
    if (code.startsWith("?.", cursor)) {
      optional = true;
      cursor = skipWs(code, cursor + 2);
    }
    if (code[cursor] === "[") {
      const bracket = parseBracket(code, cursor);
      if (!bracket) {
        return accessors;
      }
      accessors.push({ ...bracket, start, optional });
      i = bracket.end;
      continue;
    }
    if (!optional) {
      if (code[cursor] !== ".") {
        return accessors;
      }
      cursor = skipWs(code, cursor + 1);
    }
    const ident = parseIdent(code, cursor);
    if (!ident) {
      return accessors;
    }
    accessors.push({ ...ident, start, optional });
    i = ident.end;
  }
}

function parseIdent(code: string, i: number) {
  const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(code.slice(i));
  return match ? { name: match[0], end: i + match[0].length } : undefined;
}

/** Only string and integer literals; anything computed is unknowable here. */
function parseBracket(code: string, i: number) {
  const match = /^\[\s*(?:"([^"\\]*)"|'([^'\\]*)'|(\d+))\s*\]/.exec(
    code.slice(i)
  );
  if (!match) {
    return undefined;
  }
  const name =
    match[3] !== undefined ? Number(match[3]) : match[1] ?? match[2] ?? "";
  return { name, end: i + match[0].length };
}

function renderAccessors(names: string[], optional: boolean) {
  return names.map((name) => (optional ? `?.${name}` : `.${name}`)).join("");
}

const isPrefix = (was: string[], rest: PathSegment[]) =>
  was.every((segment, i) => rest[i] === segment);

/**
 * The longest rule matching the segments read off `receiver`, preferring a
 * rewrite over a manual note at equal length.
 */
function matchRule(
  receiver: string,
  rest: PathSegment[]
): { rewrite?: RewriteRule; manual?: ManualRule } {
  const longest = <T extends { was: string[] }>(rules: T[]) =>
    rules
      .filter((rule) => isPrefix(rule.was, rest))
      .sort((a, b) => b.was.length - a.was.length)[0];
  const rewrite = longest(
    REWRITE_RULES.filter((rule) => rule.receiver === receiver)
  );
  const manual = longest(
    MANUAL_RULES.filter((rule) => rule.receiver === receiver)
  );
  if (rewrite && (!manual || manual.was.length <= rewrite.was.length)) {
    return { rewrite };
  }
  return { manual };
}

const asPathString = (receiver: string, rest: PathSegment[]) =>
  ["$ctx", receiver, ...rest].join(".");

/** The first tail segment the rewritten path cannot carry on its own. */
function findSuspectTail(rule: RewriteRule, tail: PathSegment[]) {
  for (const segment of tail) {
    if (typeof segment === "string" && rule.suspectTail?.includes(segment)) {
      return segment;
    }
  }
  return undefined;
}

/** Notes a rewrite that landed somewhere a human still has to look at. */
function reportRewrite(
  rule: RewriteRule,
  receiver: string,
  rest: PathSegment[],
  report: (was: string, advice: string) => void
) {
  if (rule.alwaysReport) {
    report(asPathString(receiver, rest), rule.alwaysReport);
    return;
  }
  const suspect = findSuspectTail(rule, rest.slice(rule.was.length));
  if (suspect) {
    report(
      asPathString(receiver, rest),
      `repointed to ${rule.now.join(
        "."
      )}, but \`${suspect}\` read off it also moved in 0.4.0`
    );
  }
}

function rewriteObjectPath(
  path: PathSegment[],
  report: (was: string, advice: string) => void
) {
  if (path[0] !== "$ctx" || typeof path[1] !== "string") {
    return false;
  }
  const receiver = path[1];
  const rest = path.slice(2);
  const { rewrite, manual } = matchRule(receiver, rest);
  if (manual) {
    report(asPathString(receiver, rest), manual.advice);
    return false;
  }
  if (!rewrite) {
    return false;
  }
  reportRewrite(rewrite, receiver, rest, report);
  path.splice(2, rewrite.was.length, ...rewrite.now);
  return true;
}

export function rewriteCode(
  code: string,
  report: (was: string, advice: string) => void
): string {
  const roots: number[] = [];
  findCtxTokens(code, 0, code.length, roots);
  let result = code;
  // Right to left, so each splice leaves the earlier offsets valid.
  for (const root of roots.reverse()) {
    const accessors = parseAccessors(code, root + "$ctx".length);
    const receiver = accessors[0]?.name;
    if (typeof receiver !== "string") {
      continue;
    }
    const rest = accessors.slice(1).map((accessor) => accessor.name);
    const { rewrite, manual } = matchRule(receiver, rest);
    if (manual) {
      report(asPathString(receiver, rest), manual.advice);
      continue;
    }
    if (!rewrite) {
      continue;
    }
    const matched = accessors.slice(1, 1 + rewrite.was.length);
    reportRewrite(rewrite, receiver, rest, report);
    const optional = matched.some((accessor) => accessor.optional);
    result =
      result.slice(0, matched[0].start) +
      renderAccessors(rewrite.now, optional) +
      result.slice(matched[matched.length - 1].end);
  }
  return result;
}

export function repointInst(
  inst: BundledInst,
  report: (was: string, advice: string) => void
): boolean {
  if (inst.__type === "ObjectPath" && Array.isArray(inst.path)) {
    return rewriteObjectPath(inst.path, report);
  }
  if (inst.__type === "CustomCode" && typeof inst.code === "string") {
    const rewritten = rewriteCode(inst.code, report);
    if (rewritten === inst.code) {
      return false;
    }
    inst.code = rewritten;
    return true;
  }
  return false;
}

/**
 * Which component each instance sits under, so the worklist names somewhere a
 * person can open. Instances no component reaches are still rewritten; they are
 * just reported without a name.
 */
export function componentNamesByIid(map: Record<string, BundledInst>) {
  const owners = new Map<string, string>();
  for (const [rootIid, inst] of Object.entries(map)) {
    if (inst.__type !== "Component" || typeof inst.name !== "string") {
      continue;
    }
    const name = inst.name;
    const queue = [rootIid];
    const seen = new Set<string>([rootIid]);
    while (queue.length > 0) {
      const iid = queue.shift()!;
      if (!owners.has(iid)) {
        owners.set(iid, name);
      }
      for (const ref of refsOf(map[iid])) {
        if (!seen.has(ref) && map[ref] && map[ref].__type !== "Component") {
          seen.add(ref);
          queue.push(ref);
        }
      }
    }
  }
  return owners;
}

function refsOf(inst: BundledInst | undefined) {
  const refs: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      const ref = (value as { __ref?: unknown }).__ref;
      if (typeof ref === "string") {
        refs.push(ref);
      } else {
        Object.values(value).forEach(visit);
      }
    }
  };
  if (inst) {
    for (const [field, value] of Object.entries(inst)) {
      if (field !== "__type") {
        visit(value);
      }
    }
  }
  return refs;
}

export const migrate: BundledMigrationFn = async (bundle, entity) => {
  const map = (bundle as UnsafeBundle).map;
  const owners = componentNamesByIid(map);
  const findings: ManualFinding[] = [];
  let repointed = 0;

  for (const [iid, inst] of Object.entries(map)) {
    const report = (was: string, advice: string) =>
      findings.push({
        component: owners.get(iid) ?? "(unreferenced)",
        expr: inst.__type === "ObjectPath" ? "ObjectPath" : "CustomCode",
        was,
        advice,
      });
    if (repointInst(inst, report)) {
      repointed++;
    }
  }

  if (repointed > 0 || findings.length > 0) {
    logger().info("259-repoint-ep-commerce-bindings", {
      // Import hands us an entity carrying neither, so fall back to its id —
      // the worklist is useless if it cannot be traced to a project.
      entity:
        (entity as { projectId?: string }).projectId ??
        (entity as { pkgId?: string }).pkgId ??
        entity.id,
      repointed,
      manualWorklist: findings,
    });
  }
};

export const MIGRATION_TYPE: BundleMigrationType = "bundled";
