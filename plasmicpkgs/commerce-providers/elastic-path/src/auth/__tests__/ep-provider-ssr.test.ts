import {
  epProviderGetServerInfo,
} from "../ep-provider-server-info";
import initElasticPathClient from "../../client";

describe("epProviderGetServerInfo", () => {
  const mockOps = {
    readContext: jest.fn(),
    readDataEnv: jest.fn(),
    readDataSelector: jest.fn(),
    readDataSelectors: jest.fn(),
    fetchData: jest.fn(),
  };

  it("provides ep-server-token and ep-host contexts when serverToken is present", () => {
    const result = epProviderGetServerInfo(
      { serverToken: "my-server-token", host: "https://useast.api.elasticpath.com" },
      mockOps
    );

    expect(result).toEqual({
      providedContexts: [
        { contextKey: "ep-server-token", value: "my-server-token" },
        { contextKey: "ep-host", value: "https://useast.api.elasticpath.com" },
      ],
    });
  });

  it("returns empty object when serverToken is absent", () => {
    const result = epProviderGetServerInfo({}, mockOps);
    expect(result).toEqual({});
  });

  it("returns empty object when serverToken is empty string", () => {
    const result = epProviderGetServerInfo(
      { serverToken: "" },
      mockOps
    );
    expect(result).toEqual({});
  });
});

describe("initElasticPathClient with serverToken", () => {
  it("accepts a serverToken parameter and returns a client", () => {
    const client = initElasticPathClient(
      { clientId: "cid", host: "https://useast.api.elasticpath.com" },
      "pre-resolved-token"
    );
    expect(client).toBeDefined();
    expect(typeof client.interceptors).toBe("object");
  });

  it("works without serverToken (backward compatible)", () => {
    const client = initElasticPathClient({
      clientId: "cid",
      host: "https://useast.api.elasticpath.com",
    });
    expect(client).toBeDefined();
    expect(typeof client.interceptors).toBe("object");
  });
});
