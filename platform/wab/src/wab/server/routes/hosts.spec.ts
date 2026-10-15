/** @jest-environment node */
import { seedTestUserAndProjects } from "@/wab/server/db/DbInit";
import { SharedApiTester } from "@/wab/server/test/api-tester";
import { createBackend, createDatabase } from "@/wab/server/test/backend-util";
import { BadRequestError } from "@/wab/shared/ApiErrors/errors";

describe("trusted hosts routes", () => {
  let api: SharedApiTester;
  let baseURL: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const {
      dburi,
      con,
      cleanup: cleanupDatabase,
    } = await createDatabase("trusted_hosts_test");
    await con.transaction(async (em) => {
      await seedTestUserAndProjects(em, { email: "user@example.com" }, 0);
    });

    const { host, cleanup: cleanupBackend } = await createBackend(dburi);
    baseURL = `${host}/api/v1`;
    cleanup = async () => {
      await cleanupBackend();
      await cleanupDatabase();
    };
  });

  beforeEach(async () => {
    api = new SharedApiTester(baseURL);
    await api.refreshCsrfToken();
    await api.login({
      email: "user@example.com",
      password: "!53kr3tz!",
    });
  });

  afterEach(async () => {
    await api.dispose();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("responds with 400 if url is missing", async () => {
    await expect(
      api.addTrustedHost(undefined as unknown as string)
    ).rejects.toThrow(BadRequestError);
  });

  it("responds with 400 if url is not a string", async () => {
    await expect(
      api.addTrustedHost(123 as unknown as string)
    ).rejects.toThrow(BadRequestError);
  });

  it("responds with 400 if url is blank", async () => {
    await expect(api.addTrustedHost("   ")).rejects.toThrow(BadRequestError);
  });

  it("adds a trusted host with a trimmed url", async () => {
    await api.addTrustedHost("  https://example.com  ");
    const { trustedHosts } = await api.getTrustedHostsList();
    expect(trustedHosts.map((host) => host.hostUrl)).toContain(
      "https://example.com"
    );
  });
});
