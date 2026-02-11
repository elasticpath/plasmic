import {
  getLoaderForPath,
  replaceDataPlasmicHost,
} from "@/wab/server/loader/bundle-utils";

describe("bundle-utils", () => {
  describe("replaceDataPlasmicHost", () => {
    const originalEnv = process.env.DATA_HOST;

    afterEach(() => {
      // Restore original env
      if (originalEnv === undefined) {
        delete process.env.DATA_HOST;
      } else {
        process.env.DATA_HOST = originalEnv;
      }
    });

    it("should return null if content does not contain data.plasmic.app", () => {
      const content = 'const host = "https://example.com";';
      expect(replaceDataPlasmicHost(content)).toBeNull();
    });

    it("should replace data.plasmic.app with provided dataHost", () => {
      const content = 'const DEFAULT_HOST = "https://data.plasmic.app";';
      const result = replaceDataPlasmicHost(
        content,
        "https://data.custom.com"
      );
      expect(result).toBe('const DEFAULT_HOST = "https://data.custom.com";');
    });

    it("should replace data.plasmic.app with DATA_HOST env var when no dataHost provided", () => {
      process.env.DATA_HOST = "https://data.mycompany.com";
      const content = 'const DEFAULT_HOST = "https://data.plasmic.app";';
      const result = replaceDataPlasmicHost(content);
      expect(result).toBe('const DEFAULT_HOST = "https://data.mycompany.com";');
    });

    it("should fall back to original URL when no dataHost and no env var", () => {
      delete process.env.DATA_HOST;
      const content = 'const DEFAULT_HOST = "https://data.plasmic.app";';
      const result = replaceDataPlasmicHost(content);
      expect(result).toBe('const DEFAULT_HOST = "https://data.plasmic.app";');
    });

    it("should replace all occurrences of data.plasmic.app", () => {
      const content = `
const DEFAULT_HOST = "https://data.plasmic.app";
const BACKUP_HOST = "https://data.plasmic.app";
const url = "https://data.plasmic.app/api/v1/test";
      `.trim();

      const result = replaceDataPlasmicHost(content, "https://data.custom.com");

      expect(result).toBe(
        `
const DEFAULT_HOST = "https://data.custom.com";
const BACKUP_HOST = "https://data.custom.com";
const url = "https://data.custom.com/api/v1/test";
      `.trim()
      );
    });

    it("should handle realistic executor.tsx content", () => {
      const content = `
import fetch from "@plasmicapp/isomorphic-unfetch";

const DEFAULT_HOST = "https://data.plasmic.app";

const UNAUTHORIZED_MESSAGE =
  "You do not have permission to perform this operation.";

export async function executePlasmicDataOp(op, opts) {
  const host = getConfig("__PLASMIC_DATA_HOST", DEFAULT_HOST);
  const url = \`\${host}/api/v1/server-data/sources/\${op.sourceId}/execute\`;
  // ...
}
      `.trim();

      const result = replaceDataPlasmicHost(
        content,
        "https://data.integration.storefront.elasticpath.com"
      );

      expect(result).toContain(
        'const DEFAULT_HOST = "https://data.integration.storefront.elasticpath.com";'
      );
      expect(result).not.toContain("data.plasmic.app");
    });
  });

  describe("getLoaderForPath", () => {
    it("should return tsx for .tsx files", () => {
      expect(getLoaderForPath("/path/to/file.tsx")).toBe("tsx");
      expect(getLoaderForPath("executor.tsx")).toBe("tsx");
    });

    it("should return ts for .ts files", () => {
      expect(getLoaderForPath("/path/to/file.ts")).toBe("ts");
      expect(getLoaderForPath("executor.ts")).toBe("ts");
    });

    it("should return js for .js files", () => {
      expect(getLoaderForPath("/path/to/file.js")).toBe("js");
      expect(getLoaderForPath("executor.js")).toBe("js");
    });

    it("should return js for files without recognized extension", () => {
      expect(getLoaderForPath("/path/to/file")).toBe("js");
      expect(getLoaderForPath("/path/to/file.mjs")).toBe("js");
    });
  });
});
