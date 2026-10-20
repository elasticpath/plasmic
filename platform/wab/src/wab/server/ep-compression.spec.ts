/** @jest-environment node */
import {
  addAppAuthRoutes,
  addCmsPublicRoutes,
  addCodegenOnlyRoutes,
  addIntegrationsRoutes,
  addLoaderHtmlRoutes,
  addLoaderRoutes,
  createApp,
} from "@/wab/server/AppServer";
import { closeDbConnections, ensureDbConnections } from "@/wab/server/db/DbCon";
import { seedTestUserAndProjects } from "@/wab/server/db/DbInit";
import { DbMgr, normalActor } from "@/wab/server/db/DbMgr";
import { addStudioCompression } from "@/wab/server/ep-compression";
import { PinoLogger } from "@/wab/server/observability/PinoLogger";
import { addInternalIntegrationsRoutes } from "@/wab/server/routes/custom-routes";
import {
  createBackend,
  createDatabase,
  testConfig,
  withEnvOverrides,
} from "@/wab/server/test/backend-util";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { register } from "prom-client";
import zlib from "zlib";

type RawResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

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

function startFakeSocketServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(SOCKET_BODY);
    });
    server.listen(0, () => resolve(server));
  });
}

function listen(app: express.Application): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function close(server: http.Server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

function urlOf(server: http.Server) {
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

const OFFERS_BR = { "accept-encoding": "gzip, deflate, br" };

let dburi: string;
let cleanupDatabase: () => Promise<void>;
let authHeaders: Record<string, string>;
let pkgId: string;
let pkgPath: string;

beforeAll(async () => {
  const db = await createDatabase("ep_compression_test");
  dburi = db.dburi;
  cleanupDatabase = db.cleanup;

  await db.con.transaction(async (em) => {
    const { user, projects } = await seedTestUserAndProjects(
      em,
      { email: "user@example.com" },
      1
    );
    const userDb = new DbMgr(em, normalActor(user.id));
    const { token } = await userDb.createPersonalApiToken(user.id);
    authHeaders = {
      "x-plasmic-api-user": user.email,
      "x-plasmic-api-token": token,
    };
    const { pkgVersion } = await userDb.publishProject(
      projects[0].id,
      undefined,
      [],
      "description"
    );
    pkgId = pkgVersion.pkgId;
    pkgPath = `/api/v1/pkgs/${pkgId}`;
  });
});

afterAll(async () => {
  await cleanupDatabase?.();
});

describe("Studio server response compression", () => {
  let baseURL: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const socketServer = await startFakeSocketServer();
    const { host, cleanup: cleanupBackend } = await withEnvOverrides(
      { SOCKET_HOST: urlOf(socketServer) },
      () => createBackend(dburi)
    );
    baseURL = host;
    cleanup = async () => {
      await cleanupBackend();
      await close(socketServer);
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
    const res = await get(pkgPath, OFFERS_BR);

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

  describe("request log", () => {
    let info: jest.SpyInstance;

    beforeEach(() => {
      info = jest.spyOn(PinoLogger.prototype, "info");
    });

    afterEach(() => {
      info.mockRestore();
    });

    async function loggedRequest(requestId: string) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const call = info.mock.calls.find(
          ([, payload]) => payload?.x_request_id === requestId
        );
        if (call) {
          return call[1];
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`No request log entry for ${requestId}`);
    }

    it("records the uncompressed size and the size sent for a compressed bundle", async () => {
      const plain = await get(pkgPath);
      const res = await get(pkgPath, {
        ...OFFERS_BR,
        "x-request-id": "compressed-bundle",
      });

      const entry = await loggedRequest("compressed-bundle");
      expect(res.body.length).toBeLessThan(plain.body.length);
      expect(entry.contentLength).toBe(String(plain.body.length));
      expect(entry.contentLengthSent).toBe(res.body.length);
    });

    it("records the same size twice for an unencoded bundle", async () => {
      const res = await get(pkgPath, { "x-request-id": "unencoded-bundle" });

      const entry = await loggedRequest("unencoded-bundle");
      expect(entry.contentLength).toBe(String(res.body.length));
      expect(entry.contentLengthSent).toBe(res.body.length);
    });
  });

  describe("leaves these responses unencoded", () => {
    it.each(["/api/v1/init-token", "/api/v1/socket"])(
      "socket.io traffic on %s, proxied to the socket server",
      async (path) => {
        const res = await get(`${path}/?EIO=4&transport=polling`, OFFERS_BR);

        expect(res.status).toBe(200);
        expect(res.headers["content-encoding"]).toBeUndefined();
        expect(res.body.toString()).toBe(SOCKET_BODY);
      }
    );

    it("a 304 for a getPkgVersion conditional request", async () => {
      const { headers } = await get(pkgPath);
      const res = await get(pkgPath, {
        ...OFFERS_BR,
        "if-none-match": headers.etag ?? "",
      });

      expect(res.status).toBe(304);
      expect(res.headers["content-encoding"]).toBeUndefined();
      expect(res.headers.etag).toBe(headers.etag);
      expect(res.body).toHaveLength(0);
    });

    it("a HEAD response", async () => {
      const res = await send(pkgPath, { method: "HEAD", headers: OFFERS_BR });

      expect(res.status).toBe(200);
      expect(res.headers["content-encoding"]).toBeUndefined();
      expect(res.body).toHaveLength(0);
    });
  });
});

describe("backends that share the Express setup with Studio", () => {
  const backends: [
    string,
    (app: express.Application) => void,
    { skipSession: boolean } | undefined
  ][] = [
    ["codegen", addCodegenOnlyRoutes, undefined],
    [
      "integrations",
      (app) => {
        addCmsPublicRoutes(app);
        addIntegrationsRoutes(app);
        addAppAuthRoutes(app);
        addInternalIntegrationsRoutes(app);
      },
      { skipSession: true },
    ],
    ["loader", addLoaderRoutes, { skipSession: true }],
    ["loader-html", addLoaderHtmlRoutes, { skipSession: true }],
  ];

  beforeAll(async () => {
    await ensureDbConnections(dburi);
  });

  afterAll(async () => {
    await closeDbConnections();
    register.clear();
  });

  it.each(backends)(
    "%s sends responses unencoded",
    async (name, addRoutes, opts) => {
      // Each app registers the same metrics.
      register.clear();
      const { app } = await createApp(
        name,
        testConfig(dburi, "http://localhost"),
        addRoutes,
        undefined,
        opts
      );
      const server = await listen(app);
      try {
        const res = await rawRequest(`${urlOf(server)}/api/v1/no-such-route`, {
          headers: OFFERS_BR,
        });

        expect(res.status).toBe(404);
        expect(res.headers["content-type"]).toMatch(/json/);
        expect(res.headers["content-encoding"]).toBeUndefined();
      } finally {
        await close(server);
      }
    }
  );
});

describe("addStudioCompression", () => {
  it.each([204, 304])(
    "leaves a %d unencoded even when it has a compressible type",
    async (status) => {
      const app = express();
      addStudioCompression(app);
      app.get("/no-body", (_req, res) => {
        res.status(status).type("json").end();
      });
      const server = await listen(app);
      try {
        const res = await rawRequest(`${urlOf(server)}/no-body`, {
          headers: OFFERS_BR,
        });

        expect(res.status).toBe(status);
        expect(res.headers["content-encoding"]).toBeUndefined();
      } finally {
        await close(server);
      }
    }
  );
});
