import { DEFAULT_HOST_ALLOWLIST, isAllowedEpHost } from "../host-allowlist";

const originalNodeEnv = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined) {
  if (value === undefined) delete (process.env as any).NODE_ENV;
  else (process.env as any).NODE_ENV = value;
}

afterEach(() => setNodeEnv(originalNodeEnv));

describe("isAllowedEpHost", () => {
  it("accepts the Elastic Path regions and the integration host", () => {
    expect(isAllowedEpHost("https://useast.api.elasticpath.com")).toBe(true);
    expect(isAllowedEpHost("https://euwest.api.elasticpath.com")).toBe(true);
    expect(isAllowedEpHost("https://elasticpath.com")).toBe(true);
    expect(
      isAllowedEpHost("https://epcc-integration.global.ssl.fastly.net")
    ).toBe(true);
  });

  it("rejects lookalike domains", () => {
    expect(isAllowedEpHost("https://elasticpath.com.evil.test")).toBe(false);
    expect(isAllowedEpHost("https://notelasticpath.com")).toBe(false);
  });

  it("is case-insensitive on both host and pattern", () => {
    expect(isAllowedEpHost("https://EUWest.API.ElasticPath.com")).toBe(true);
    expect(
      isAllowedEpHost("https://commerce.acme.test", ["*.ACME.test"])
    ).toBe(true);
  });

  it("matches a bare host, with or without a port", () => {
    expect(isAllowedEpHost("epcc.internal", ["epcc.internal"])).toBe(true);
    expect(isAllowedEpHost("epcc.internal:8080", ["epcc.internal"])).toBe(true);
    expect(
      isAllowedEpHost("https://epcc.internal:8080", ["epcc.internal"])
    ).toBe(true);
  });

  it("ignores a path on either side", () => {
    expect(
      isAllowedEpHost("https://commerce.acme.test/v2", ["commerce.acme.test"])
    ).toBe(true);
  });

  it("allows loopback outside production but not in it", () => {
    setNodeEnv("development");
    expect(isAllowedEpHost("http://localhost:3456")).toBe(true);
    expect(isAllowedEpHost("http://127.0.0.1:9999")).toBe(true);

    setNodeEnv("production");
    expect(isAllowedEpHost("http://localhost:3456")).toBe(false);
    expect(isAllowedEpHost("http://127.0.0.1:9999")).toBe(false);
  });

  it("still honours an explicitly allowlisted loopback host in production", () => {
    setNodeEnv("production");
    expect(isAllowedEpHost("http://localhost:3456", ["localhost"])).toBe(true);
  });

  it("does not carry loopback in the published default list", () => {
    expect(DEFAULT_HOST_ALLOWLIST).not.toContain("localhost");
    expect(DEFAULT_HOST_ALLOWLIST).not.toContain("127.0.0.1");
  });

  it("rejects junk", () => {
    expect(isAllowedEpHost("")).toBe(false);
    expect(isAllowedEpHost("   ")).toBe(false);
    expect(isAllowedEpHost("not a host")).toBe(false);
  });
});
