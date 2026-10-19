/** @jest-environment node */
import { seedTestUserAndProjects } from "@/wab/server/db/DbInit";
import { DbMgr, normalActor } from "@/wab/server/db/DbMgr";
import { createBackend, createDatabase } from "@/wab/server/test/backend-util";
import http from "http";
import zlib from "zlib";

type RawResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

/** Sends a request and returns the body exactly as it came off the wire. */
function rawRequest(
  url: string,
  opts: { method?: string; headers?: Record<string, string> } = {}
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method: opts.method ?? "GET", headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        );
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Studio server response compression", () => {
  let baseURL: string;
  let authHeaders: Record<string, string>;
  let pkgId: string;
  let pkgPath: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const {
      dburi,
      con,
      cleanup: cleanupDatabase,
    } = await createDatabase("ep_compression_test");

    await con.transaction(async (em) => {
      const { user, projects } = await seedTestUserAndProjects(
        em,
        { email: "user@example.com" },
        1
      );
      const db = new DbMgr(em, normalActor(user.id));
      const { token } = await db.createPersonalApiToken(user.id);
      authHeaders = {
        "x-plasmic-api-user": user.email,
        "x-plasmic-api-token": token,
      };
      const { pkgVersion } = await db.publishProject(
        projects[0].id,
        undefined,
        [],
        "description"
      );
      pkgId = pkgVersion.pkgId;
      pkgPath = `/api/v1/pkgs/${pkgId}`;
    });

    const { host, cleanup: cleanupBackend } = await createBackend(dburi);
    baseURL = host;
    cleanup = async () => {
      await cleanupBackend();
      await cleanupDatabase();
    };
  });

  afterAll(async () => {
    await cleanup?.();
  });

  function get(path: string, headers: Record<string, string> = {}) {
    return rawRequest(`${baseURL}${path}`, {
      headers: { ...authHeaders, ...headers },
    });
  }

  it("brotli-encodes a bundle when the client offers br", async () => {
    const plain = await get(pkgPath);
    const res = await get(pkgPath, { "accept-encoding": "gzip, deflate, br" });

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers.vary).toMatch(/accept-encoding/i);
    expect(zlib.brotliDecompressSync(res.body)).toEqual(plain.body);
  });

  it("gzip-encodes a bundle when the client offers gzip but not br", async () => {
    const plain = await get(pkgPath);
    const res = await get(pkgPath, { "accept-encoding": "gzip, deflate" });

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers.vary).toMatch(/accept-encoding/i);
    expect(zlib.gunzipSync(res.body)).toEqual(plain.body);
  });

  it("sends a bundle unencoded when the client offers no encoding", async () => {
    const res = await get(pkgPath);

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.headers.vary).toMatch(/accept-encoding/i);
    expect(JSON.parse(res.body.toString()).pkg.pkgId).toBe(pkgId);
  });
});
