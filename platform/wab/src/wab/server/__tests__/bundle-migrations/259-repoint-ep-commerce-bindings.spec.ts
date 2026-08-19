import {
  ManualFinding,
  migrate,
  repointInst,
  rewriteCode,
} from "@/wab/server/bundle-migrations/259-repoint-ep-commerce-bindings";
import { ProjectRevision } from "@/wab/server/entities/Entities";
import { logger } from "@/wab/server/observability";
import { Bundler } from "@/wab/shared/bundler";
import { Bundle, BundledInst, UnsafeBundle } from "@/wab/shared/bundles";
import { ComponentType, mkComponent } from "@/wab/shared/core/components";
import { mkParam } from "@/wab/shared/core/lang";
import { createSite } from "@/wab/shared/core/sites";
import { mkTplTagX } from "@/wab/shared/core/tpls";
import {
  Component,
  CustomCode,
  ObjectPath,
  Site,
} from "@/wab/shared/model/classes";
import { typeFactory } from "@/wab/shared/model/model-util";
import { mkBaseVariant } from "@/wab/shared/Variants";
import { ensureVariantSetting } from "@/wab/shared/Variants";

function rewrite(code: string) {
  return rewriteCode(code, jest.fn());
}

function findings(inst: BundledInst) {
  const collected: Omit<ManualFinding, "component" | "expr">[] = [];
  repointInst(inst, (was, advice) => collected.push({ was, advice }));
  return collected;
}

function customCode(code: string): BundledInst {
  return { __type: "CustomCode", code, fallback: null };
}

function objectPath(path: (string | number)[]): BundledInst {
  return { __type: "ObjectPath", path, fallback: null };
}

describe("259-repoint-ep-commerce-bindings", () => {
  describe("deterministic renames", () => {
    it.each([
      ["($ctx.currentProduct.name)", "($ctx.currentProduct.attributes.name)"],
      [
        "($ctx.currentProduct.description)",
        "($ctx.currentProduct.attributes.description)",
      ],
      ["($ctx.currentProduct.sku)", "($ctx.currentProduct.attributes.sku)"],
      ["($ctx.currentProduct.slug)", "($ctx.currentProduct.attributes.slug)"],
      [
        "($ctx.currentProduct.price.formatted)",
        "($ctx.currentProduct.meta.display_price.without_tax.formatted)",
      ],
      [
        "($ctx.currentProduct.price.currencyCode)",
        "($ctx.currentProduct.meta.display_price.without_tax.currency)",
      ],
      ["($ctx.currentProduct.options)", "($ctx.currentProduct.variations)"],
      ["($ctx.currentProduct.variants)", "($ctx.currentProduct.childProducts)"],
      ["($ctx.cart.lineItems)", "($ctx.cart.items)"],
      [
        "($ctx.cart.subtotalPrice)",
        "($ctx.cart.meta.display_price.without_tax)",
      ],
      ["($ctx.cart.totalPrice)", "($ctx.cart.meta.display_price.with_tax)"],
      [
        "($ctx.cart.currency.code)",
        "($ctx.cart.meta.display_price.without_tax.currency)",
      ],
      [
        "($ctx.currentCartItem.imageUrl)",
        "($ctx.currentCartItem.image.href)",
      ],
      [
        "($ctx.currentVariationOption.label)",
        "($ctx.currentVariationOption.name)",
      ],
    ])("rewrites %s", (before, after) => {
      expect(rewrite(before)).toBe(after);
    });

    it("rewrites ObjectPath segments in place", () => {
      const expr = objectPath(["$ctx", "currentProduct", "price", "formatted"]);
      repointInst(expr, jest.fn());
      expect(expr.path).toEqual([
        "$ctx",
        "currentProduct",
        "meta",
        "display_price",
        "without_tax",
        "formatted",
      ]);
    });

    it("leaves the segments after the rewritten span alone", () => {
      expect(rewrite("($ctx.currentProduct.variants[0].id)")).toBe(
        "($ctx.currentProduct.childProducts[0].id)"
      );
    });

    it("rewrites every occurrence in one expression", () => {
      expect(
        rewrite("($ctx.currentProduct.name + \" — \" + $ctx.cart.totalPrice)")
      ).toBe(
        "($ctx.currentProduct.attributes.name + \" — \" + $ctx.cart.meta.display_price.with_tax)"
      );
    });

    it("rewrites inside a template-literal interpolation", () => {
      expect(rewrite("(`${$ctx.currentProduct.sku} in stock`)")).toBe(
        "(`${$ctx.currentProduct.attributes.sku} in stock`)"
      );
    });

    it("rewrites inside a nested interpolation", () => {
      expect(
        rewrite("(`${[1].map((i) => `${$ctx.cart.lineItems.length}`)}`)")
      ).toBe("(`${[1].map((i) => `${$ctx.cart.items.length}`)}`)");
    });
  });

  describe("optional chaining", () => {
    it("carries an optional accessor through the inserted hops", () => {
      expect(rewrite("($ctx.currentProduct?.name)")).toBe(
        "($ctx.currentProduct?.attributes?.name)"
      );
    });

    it("treats the whole replacement as optional if any matched accessor is", () => {
      expect(rewrite("($ctx.currentProduct.price?.formatted)")).toBe(
        "($ctx.currentProduct?.meta?.display_price?.without_tax?.formatted)"
      );
    });

    it("stays non-optional when the original was", () => {
      expect(rewrite("($ctx.cart.currency.code)")).toBe(
        "($ctx.cart.meta.display_price.without_tax.currency)"
      );
    });

    it("reads a bracketed segment", () => {
      expect(rewrite('($ctx["currentProduct"]["name"])')).toBe(
        '($ctx["currentProduct"].attributes.name)'
      );
    });
  });

  describe("things it must not touch", () => {
    it.each([
      // Already migrated — the migration has to be idempotent.
      "($ctx.currentProduct.attributes.name)",
      "($ctx.currentProduct.meta.display_price.without_tax.formatted)",
      "($ctx.cart.items.length)",
      // Not a receiver we know.
      "($ctx.currentCategory.name)",
      "($ctx.options.name)",
      // Same leaf name on a different root.
      "($state.currentProduct.name)",
      "($props.currentProduct.name)",
      // A bare receiver reference is still valid.
      "($ctx.currentProduct)",
      // `$ctx` as part of a longer identifier.
      "($ctxCurrentProduct.name)",
      "(my$ctx.currentProduct.name)",
      // Computed access — the segment is unknowable.
      "($ctx.currentProduct[field])",
      // Deliberately excluded, per the 0.4.0 runbook.
      '("$" + $ctx.currentProduct.price.value.toFixed(2))',
      "($ctx.currentProduct.path)",
      "($ctx.cartData.items.length)",
      "($ctx.checkoutCartData.totalPrice)",
    ])("leaves %s unchanged", (code) => {
      expect(rewrite(code)).toBe(code);
    });

    it("does not rewrite inside a string literal", () => {
      expect(rewrite('("bind $ctx.currentProduct.name here")')).toBe(
        '("bind $ctx.currentProduct.name here")'
      );
    });

    it("does not rewrite inside a comment", () => {
      expect(rewrite("(1 /* $ctx.currentProduct.name */)")).toBe(
        "(1 /* $ctx.currentProduct.name */)"
      );
      expect(rewrite("(1) // $ctx.cart.lineItems")).toBe(
        "(1) // $ctx.cart.lineItems"
      );
    });

    it("does not rewrite template-literal text outside an interpolation", () => {
      expect(rewrite("(`$ctx.currentProduct.name`)")).toBe(
        "(`$ctx.currentProduct.name`)"
      );
    });

    it("leaves an ObjectPath that is not rooted on $ctx alone", () => {
      const expr = objectPath(["$state", "currentProduct", "name"]);
      repointInst(expr, jest.fn());
      expect(expr.path).toEqual(["$state", "currentProduct", "name"]);
    });
  });

  describe("the manual worklist", () => {
    it("reports price.value with the formatted-string advice", () => {
      expect(
        findings(customCode('("$" + $ctx.currentProduct.price.value.toFixed(2))'))
      ).toEqual([
        {
          was: "$ctx.currentProduct.price.value.toFixed",
          advice:
            "meta.display_price.without_tax.formatted, dropping the surrounding currency arithmetic",
        },
      ]);
    });

    it("prefers the longer rewrite over the price note", () => {
      expect(findings(customCode("($ctx.currentProduct.price.formatted)"))).toEqual(
        []
      );
    });

    it("reports a bare price read", () => {
      expect(findings(customCode("($ctx.currentProduct.price)"))).toEqual([
        {
          was: "$ctx.currentProduct.price",
          advice: "meta.display_price.without_tax",
        },
      ]);
    });

    it("reports the removed cart contexts whatever is read off them", () => {
      expect(findings(objectPath(["$ctx", "cartData", "lineItems"]))).toEqual([
        { was: "$ctx.cartData.lineItems", advice: "$ctx.cart" },
      ]);
    });

    it("reports a moved field read through a rewritten collection", () => {
      const expr = customCode("($ctx.currentProduct.variants[0].sku)");
      expect(findings(expr)).toEqual([
        {
          was: "$ctx.currentProduct.variants.0.sku",
          advice:
            "repointed to childProducts, but `sku` read off it also moved in 0.4.0",
        },
      ]);
      expect(expr.code).toBe("($ctx.currentProduct.childProducts[0].sku)");
    });

    it("does not flag a tail the new shape still carries", () => {
      expect(findings(customCode("($ctx.cart.lineItems.length)"))).toEqual([]);
      expect(findings(customCode("($ctx.cart.lineItems[0].quantity)"))).toEqual(
        []
      );
    });

    it("reports the search-hit fields and the removed option colours", () => {
      expect(
        findings(customCode("($ctx.currentProduct._highlightedName)"))
      ).toEqual([
        {
          was: "$ctx.currentProduct._highlightedName",
          advice: "$ctx.currentHit.highlightedName",
        },
      ]);
      expect(
        findings(customCode("($ctx.currentVariationOption.hexColors[0])"))
      ).toEqual([
        {
          was: "$ctx.currentVariationOption.hexColors.0",
          advice:
            "removed — Elastic Path has no colour on a variation option; source it yourself",
        },
      ]);
    });
  });

  describe("over a bundle", () => {
    function mkSite() {
      const baseVariant = mkBaseVariant();
      const tpl = mkTplTagX("div", { baseVariant });
      const vs = ensureVariantSetting(tpl, [baseVariant]);
      vs.attrs["title"] = new CustomCode({
        code: "($ctx.currentProduct.name)",
        fallback: new CustomCode({
          code: "($ctx.currentProduct.price.value)",
          fallback: undefined,
        }),
      });
      const param = mkParam({
        name: "total",
        paramType: "prop",
        type: typeFactory.text(),
      });
      param.defaultExpr = new ObjectPath({
        path: ["$ctx", "cart", "totalPrice"],
        fallback: undefined,
      });
      const component: Component = mkComponent({
        name: "ProductCard",
        type: ComponentType.Plain,
        tplTree: tpl,
        params: [param],
        variants: [baseVariant],
      });
      const site: Site = createSite();
      site.components.push(component);
      return site;
    }

    const entity = {
      id: "test-entity",
      projectId: "testProject",
    } as ProjectRevision;

    function bundleOf(site: Site) {
      return new Bundler().bundle(
        site,
        "test-entity",
        "258-add-code-component-subtree-prefetching-config"
      ) as Bundle;
    }

    function exprs(bundle: UnsafeBundle) {
      const codes = Object.values(bundle.map)
        .filter((inst) => inst.__type === "CustomCode")
        .map((inst) => inst.code as string)
        .sort();
      const paths = Object.values(bundle.map)
        .filter((inst) => inst.__type === "ObjectPath")
        .map((inst) => (inst.path as (string | number)[]).join("."))
        .sort();
      return { codes, paths };
    }

    it("repoints bindings on attrs, fallbacks and param defaults", async () => {
      const bundle = bundleOf(mkSite());
      await migrate(bundle, entity);
      expect(exprs(bundle)).toEqual({
        codes: [
          "($ctx.currentProduct.attributes.name)",
          // The excluded `price.value` fallback is reached and left be.
          "($ctx.currentProduct.price.value)",
        ],
        paths: ["$ctx.cart.meta.display_price.with_tax"],
      });
    });

    it("is idempotent", async () => {
      const bundle = bundleOf(mkSite());
      await migrate(bundle, entity);
      const once = exprs(bundle);
      await migrate(bundle, entity);
      expect(exprs(bundle)).toEqual(once);
    });

    it("names the owning component in the worklist", async () => {
      const bundle = bundleOf(mkSite());
      const logged: unknown[] = [];
      jest
        .spyOn(logger(), "info")
        .mockImplementation((...args: unknown[]) => logged.push(args) as never);
      await migrate(bundle, entity);
      jest.restoreAllMocks();
      expect(logged).toHaveLength(1);
      const payload = (logged[0] as unknown[])[1] as {
        projectId: string;
        repointed: number;
        manualWorklist: ManualFinding[];
      };
      expect(payload.projectId).toBe("testProject");
      expect(payload.repointed).toBe(2);
      expect(
        [...payload.manualWorklist].sort((a, b) => a.was.localeCompare(b.was))
      ).toEqual([
        {
          component: "ProductCard",
          expr: "ObjectPath",
          was: "$ctx.cart.totalPrice",
          advice:
            "was a number in minor units, now a money object — read `.formatted` and drop any division or toFixed",
        },
        {
          component: "ProductCard",
          expr: "CustomCode",
          was: "$ctx.currentProduct.price.value",
          advice:
            "meta.display_price.without_tax.formatted, dropping the surrounding currency arithmetic",
        },
      ]);
    });

    it("migrates a bundle the bundler itself would reject", async () => {
      // A data token bound to a page's Open Graph image leaves a bare ObjectPath
      // where the model allows only String / ImageAssetRef / TemplatedString, so
      // unbundling this throws. Reading the bundle directly does not.
      const bundle: UnsafeBundle = {
        root: "page",
        deps: [],
        version: "258-add-code-component-subtree-prefetching-config",
        map: {
          page: { __type: "PageMeta", openGraphImage: { __ref: "token" } },
          token: {
            __type: "ObjectPath",
            path: ["$dataTokens_abc_pageImage"],
            fallback: null,
          },
          binding: {
            __type: "CustomCode",
            code: "($ctx.cart.lineItems.length)",
            fallback: null,
          },
        },
      };
      await expect(migrate(bundle, entity)).resolves.toBeUndefined();
      expect(bundle.map["binding"].code).toBe("($ctx.cart.items.length)");
      expect(bundle.map["token"].path).toEqual(["$dataTokens_abc_pageImage"]);
    });
  });
});
