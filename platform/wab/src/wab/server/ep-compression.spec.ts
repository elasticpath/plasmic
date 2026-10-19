/** @jest-environment node */
import { seedTestUserAndProjects } from "@/wab/server/db/DbInit";
import { DbMgr, normalActor } from "@/wab/server/db/DbMgr";
import { createBackend, createDatabase } from "@/wab/server/test/backend-util";
import http from "http";
import { AddressInfo } from "net";
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

const SOCKET_BODY = JSON.stringify({ sid: "x".repeat(4096) });

/** Stands in for the socket server that Studio proxies to in production. */
function startFakeSocketServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(SOCKET_BODY);
    });
    server.listen(0, () => resolve(server));
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

    const socketServer = await startFakeSocketServer();
    process.env.SOCKET_HOST = `http://localhost:${
      (socketServer.address() as AddressInfo).port
    }`;
    const { host, cleanup: cleanupBackend } = await createBackend(
      dburi
    ).finally(() => delete process.env.SOCKET_HOST);
    baseURL = host;
    cleanup = async () => {
      await cleanupBackend();
      socketServer.closeAllConnections();
      await new Promise((resolve) => socketServer.close(resolve));
      await cleanupDatabase();
    };
  });

  afterAll(async () => {
    await cleanup?.();
  });

  function send(
    path: string,
    { method = "GET", headers = {} }: { method?: string; headers?: {} } = {}
  ) {
    return rawRequest(`${baseURL}${path}`, {
      method,
      headers: { ...authHeaders, ...headers },
    });
  }

  function get(path: string, headers: Record<string, string> = {}) {
    return send(path, { headers });
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

  describe("leaves these responses unencoded", () => {
    const offersBr = { "accept-encoding": "gzip, deflate, br" };

    it.each(["/api/v1/init-token", "/api/v1/socket"])(
      "socket.io traffic on %s, proxied to the socket server",
      async (path) => {
        const res = await get(`${path}/?EIO=4&transport=polling`, offersBr);

        expect(res.status).toBe(200);
        expect(res.headers["content-encoding"]).toBeUndefined();
        expect(res.body.toString()).toBe(SOCKET_BODY);
      }
    );

    it("a 304 for a getPkgVersion conditional request", async () => {
      const { headers } = await get(pkgPath);
      const res = await get(pkgPath, {
        ...offersBr,
        "if-none-match": headers.etag ?? "",
      });

      expect(res.status).toBe(304);
      expect(res.headers["content-encoding"]).toBeUndefined();
      expect(res.headers.etag).toBe(headers.etag);
      expect(res.body).toHaveLength(0);
    });

    it("a 204", async () => {
      const res = await send("/api/v1/cms/databases/db/tables", {
        method: "OPTIONS",
        headers: {
          ...offersBr,
          origin: "https://example.com",
          "access-control-request-method": "GET",
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers["content-encoding"]).toBeUndefined();
    });

    it("a HEAD response", async () => {
      const res = await send(pkgPath, { method: "HEAD", headers: offersBr });

      expect(res.status).toBe(200);
      expect(res.headers["content-encoding"]).toBeUndefined();
      expect(res.body).toHaveLength(0);
    });
  });
});
