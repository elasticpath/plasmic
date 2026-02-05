import { isCmOriginAllowed } from "@/wab/server/cm-cors";

describe("isCmOriginAllowed", () => {
  describe("valid origins", () => {
    it("should allow *.cm.elasticpath.com origins", () => {
      expect(isCmOriginAllowed("https://integration.cm.elasticpath.com")).toBe(
        true
      );
      expect(isCmOriginAllowed("https://staging.cm.elasticpath.com")).toBe(true);
      expect(isCmOriginAllowed("https://useast.cm.elasticpath.com")).toBe(true);
      expect(isCmOriginAllowed("https://euwest.cm.elasticpath.com")).toBe(true);
      expect(isCmOriginAllowed("https://new-env.cm.elasticpath.com")).toBe(true);
    });

    it("should allow localhost:3000", () => {
      expect(isCmOriginAllowed("http://localhost:3000")).toBe(true);
    });

    it("should allow Vercel preview deployments", () => {
      expect(
        isCmOriginAllowed(
          "https://3492--integration-commerce-manager.vercel.app"
        )
      ).toBe(true);
      expect(
        isCmOriginAllowed("https://123--staging-commerce-manager.vercel.app")
      ).toBe(true);
      expect(
        isCmOriginAllowed("https://99999--prod-commerce-manager.vercel.app")
      ).toBe(true);
    });

    it("should allow Vercel production deployments", () => {
      expect(
        isCmOriginAllowed("https://integration-commerce-manager.vercel.app")
      ).toBe(true);
      expect(
        isCmOriginAllowed("https://staging-commerce-manager.vercel.app")
      ).toBe(true);
      expect(
        isCmOriginAllowed("https://euwest-commerce-manager.vercel.app")
      ).toBe(true);
      expect(
        isCmOriginAllowed("https://useast-commerce-manager.vercel.app")
      ).toBe(true);
    });
  });

  describe("invalid origins", () => {
    it("should reject undefined/null origins", () => {
      expect(isCmOriginAllowed(undefined)).toBe(false);
    });

    it("should reject malicious domains", () => {
      expect(isCmOriginAllowed("https://malicious.com")).toBe(false);
      expect(isCmOriginAllowed("https://evil.cm.elasticpath.com.attacker.com")).toBe(
        false
      );
    });

    it("should reject domains trying to bypass with similar names", () => {
      expect(isCmOriginAllowed("https://cm.elasticpath.com")).toBe(false);
      expect(isCmOriginAllowed("https://fakecm.elasticpath.com")).toBe(false);
      expect(isCmOriginAllowed("https://test.cm.elasticpath.com.evil.com")).toBe(
        false
      );
    });

    it("should reject origins with underscores (invalid DNS)", () => {
      expect(isCmOriginAllowed("https://test_env.cm.elasticpath.com")).toBe(
        false
      );
    });

    it("should reject http instead of https for production domains", () => {
      expect(isCmOriginAllowed("http://integration.cm.elasticpath.com")).toBe(
        false
      );
    });

    it("should reject localhost on other ports", () => {
      expect(isCmOriginAllowed("http://localhost:3001")).toBe(false);
      expect(isCmOriginAllowed("http://localhost:8080")).toBe(false);
    });

    it("should reject invalid Vercel preview URLs", () => {
      expect(isCmOriginAllowed("https://random.vercel.app")).toBe(false);
      expect(
        isCmOriginAllowed("https://not-a-number--integration-commerce-manager.vercel.app")
      ).toBe(false);
      expect(
        isCmOriginAllowed("https://123--other-app.vercel.app")
      ).toBe(false);
    });

    it("should reject invalid Vercel production URLs", () => {
      // Must end with -commerce-manager.vercel.app
      expect(isCmOriginAllowed("https://integration-other-app.vercel.app")).toBe(
        false
      );
      // Must start with alphanumeric, not hyphen
      expect(isCmOriginAllowed("https://-commerce-manager.vercel.app")).toBe(
        false
      );
    });

    it("should reject origins with ports for production domains", () => {
      expect(isCmOriginAllowed("https://integration.cm.elasticpath.com:8080")).toBe(
        false
      );
    });
  });
});
