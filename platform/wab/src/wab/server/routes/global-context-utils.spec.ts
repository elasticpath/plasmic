import { UpdateGlobalContextReq } from "@/wab/shared/ApiSchema";
import { mkBaseVariant } from "@/wab/shared/Variants";
import { ComponentType, mkComponent } from "@/wab/shared/core/components";
import { tryExtractJson } from "@/wab/shared/core/exprs";
import { mkParam } from "@/wab/shared/core/lang";
import { createSite } from "@/wab/shared/core/sites";
import { mkTplComponentX, mkTplTagX } from "@/wab/shared/core/tpls";
import { Site, TplComponent } from "@/wab/shared/model/classes";
import { typeFactory } from "@/wab/shared/model/model-util";
import { applyGlobalContextUpdates } from "./global-context-utils";

describe("global-context-utils", () => {
  let site: Site;
  let globalContextTpl: TplComponent;

  beforeEach(() => {
    site = createSite();

    // Create params first
    const clientIdParam = mkParam({
      name: "clientId",
      paramType: "prop",
      type: typeFactory.text(),
    });
    const hostParam = mkParam({
      name: "host",
      paramType: "prop",
      type: typeFactory.text(),
    });
    const enabledParam = mkParam({
      name: "enabled",
      paramType: "prop",
      type: typeFactory.bool(),
    });

    // Create base variant first
    const baseVariant = mkBaseVariant();

    // Create a component with params and the base variant
    const contextComponent = mkComponent({
      name: "TestGlobalContext",
      type: ComponentType.Plain,
      tplTree: mkTplTagX("div", { baseVariant }),
      params: [clientIdParam, hostParam, enabledParam],
      variants: [baseVariant],
    });

    // Create TplComponent instance for the global context
    globalContextTpl = mkTplComponentX({
      component: contextComponent,
      baseVariant,
    });

    // Add to site's global contexts
    site.globalContexts.push(globalContextTpl);
  });

  describe("applyGlobalContextUpdates", () => {
    it("should return empty array when no updates provided", () => {
      const warnings = applyGlobalContextUpdates(site, []);
      expect(warnings).toEqual([]);
    });

    it("should apply updates to existing global context", () => {
      const updates: UpdateGlobalContextReq[] = [
        {
          name: "TestGlobalContext",
          props: {
            clientId: "test-client-id",
            host: "https://api.example.com",
          },
        },
      ];

      const warnings = applyGlobalContextUpdates(site, updates);
      expect(warnings).toEqual([]);

      // Verify the args were set
      const args = globalContextTpl.vsettings[0].args;
      const clientIdArg = args.find(
        (arg) => arg.param.variable.name === "clientId"
      );
      const hostArg = args.find((arg) => arg.param.variable.name === "host");

      expect(clientIdArg).toBeDefined();
      expect(hostArg).toBeDefined();
      expect(tryExtractJson(clientIdArg!.expr)).toBe("test-client-id");
      expect(tryExtractJson(hostArg!.expr)).toBe("https://api.example.com");
    });

    it("should return warning when global context not found", () => {
      const updates: UpdateGlobalContextReq[] = [
        {
          name: "NonExistentContext",
          props: { clientId: "test" },
        },
      ];

      const warnings = applyGlobalContextUpdates(site, updates);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("NonExistentContext");
      expect(warnings[0]).toContain("not found");
    });

    it("should return warning when prop not found on context", () => {
      const updates: UpdateGlobalContextReq[] = [
        {
          name: "TestGlobalContext",
          props: { nonExistentProp: "value" },
        },
      ];

      const warnings = applyGlobalContextUpdates(site, updates);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("nonExistentProp");
      expect(warnings[0]).toContain("not found");
    });

    it("should handle multiple updates, collecting all warnings", () => {
      const updates: UpdateGlobalContextReq[] = [
        {
          name: "TestGlobalContext",
          props: { clientId: "valid-value", badProp: "invalid" },
        },
        {
          name: "NonExistentContext",
          props: { anything: "value" },
        },
      ];

      const warnings = applyGlobalContextUpdates(site, updates);
      expect(warnings).toHaveLength(2);
      expect(warnings).toContainEqual(
        expect.stringContaining("badProp")
      );
      expect(warnings).toContainEqual(
        expect.stringContaining("NonExistentContext")
      );
    });

    it("should return warning when context has no variant settings", () => {
      // Remove all variant settings
      globalContextTpl.vsettings.length = 0;

      const updates: UpdateGlobalContextReq[] = [
        {
          name: "TestGlobalContext",
          props: { clientId: "test" },
        },
      ];

      const warnings = applyGlobalContextUpdates(site, updates);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("no variant settings");
    });

    it("should handle null prop values", () => {
      const updates: UpdateGlobalContextReq[] = [
        {
          name: "TestGlobalContext",
          props: { clientId: null },
        },
      ];

      const warnings = applyGlobalContextUpdates(site, updates);
      expect(warnings).toEqual([]);

      const args = globalContextTpl.vsettings[0].args;
      const clientIdArg = args.find(
        (arg) => arg.param.variable.name === "clientId"
      );
      expect(clientIdArg).toBeDefined();
      expect(tryExtractJson(clientIdArg!.expr)).toBe(null);
    });

    it("should handle boolean prop values", () => {
      const updates: UpdateGlobalContextReq[] = [
        {
          name: "TestGlobalContext",
          props: { enabled: true },
        },
      ];

      const warnings = applyGlobalContextUpdates(site, updates);
      expect(warnings).toEqual([]);

      const args = globalContextTpl.vsettings[0].args;
      const enabledArg = args.find(
        (arg) => arg.param.variable.name === "enabled"
      );
      expect(enabledArg).toBeDefined();
      expect(tryExtractJson(enabledArg!.expr)).toBe(true);
    });
  });
});
