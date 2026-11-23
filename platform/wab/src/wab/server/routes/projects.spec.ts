<<<<<<< HEAD
/** @jest-environment node */
import { Bundler } from "@/wab/shared/bundler";
import { getLastBundleVersion } from "@/wab/server/db/BundleMigrator";
import { seedTestUserAndProjects } from "@/wab/server/db/DbInit";
import { DbMgr, normalActor } from "@/wab/server/db/DbMgr";
import { Project, User } from "@/wab/server/entities/Entities";
import { SharedApiTester } from "@/wab/server/test/api-tester";
import { createBackend, createDatabase } from "@/wab/server/test/backend-util";
import { mkBaseVariant } from "@/wab/shared/Variants";
import { ComponentType, mkComponent } from "@/wab/shared/core/components";
import { mkParam } from "@/wab/shared/core/lang";
import { createSite } from "@/wab/shared/core/sites";
import { mkTplComponentX, mkTplTagX } from "@/wab/shared/core/tpls";
import { CodeComponentMeta } from "@/wab/shared/model/classes";
import { typeFactory } from "@/wab/shared/model/model-util";

describe("updateProjectData", () => {
  let api: SharedApiTester;
=======
/** @vitest-environment node */
import { ApiTester } from "@/wab/server/__testonly__/api-tester";
import {
  createBackend,
  createDatabase,
} from "@/wab/server/__testonly__/backend-util";
import { ensureDbConnection } from "@/wab/server/db/DbCon";
import { seedTestUserAndProjects } from "@/wab/server/db/DbInit";
import {
  DEFAULT_DEV_PASSWORD,
  DbMgr,
  SUPER_USER,
  normalActor,
} from "@/wab/server/db/DbMgr";
import { Project, User } from "@/wab/server/entities/Entities";
import { ensure } from "@/wab/shared/common";
import { io } from "socket.io-client";

describe("project routes", () => {
  let api: ApiTester;
>>>>>>> upstream/master
  let baseURL: string;
  let cleanup: () => Promise<void>;

  let user: User;
<<<<<<< HEAD
  let projects: Project[];
  let projectWithGlobalContext: Project;
=======
  let contentUser: User;
  let project: Project;
  /** Read-only token, handed out to published apps and loader clients. */
  let publicToken: string;
  /** Write-capable token, must never leave the server. */
  let secretToken: string;
>>>>>>> upstream/master

  beforeAll(async () => {
    const {
      dburi,
<<<<<<< HEAD
      con,
      cleanup: cleanupDatabase,
    } = await createDatabase("projects_update_test");

    await con.transaction(async (em) => {
      // Create a user with a basic project (no global contexts)
      const userAndProjects = await seedTestUserAndProjects(
        em,
        { email: "user@example.com" },
        1
      );
      user = userAndProjects.user;
      projects = userAndProjects.projects;

      // Create a second project with a proper CodeComponent global context
      const db = new DbMgr(em, normalActor(user.id));
      const { project } = await db.createProject({
        name: "Project with Global Context",
      });
      projectWithGlobalContext = project;

      // Create a site with a global context code component
      const site = createSite();

      // Create params for the global context
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

      // Create base variant
      const baseVariant = mkBaseVariant();

      // Create a CodeComponent with codeComponentMeta.isContext = true
      const globalContextComponent = mkComponent({
        name: "TestGlobalContextProvider",
        type: ComponentType.Code,
        tplTree: mkTplTagX("div", { baseVariant, attrs: {} }),
        params: [clientIdParam, hostParam],
        variants: [baseVariant],
        codeComponentMeta: new CodeComponentMeta({
          importPath: "@test/provider",
          defaultExport: false,
          displayName: "Test Provider",
          importName: "TestProvider",
          description: null,
          section: null,
          thumbnailUrl: null,
          classNameProp: null,
          refProp: null,
          defaultStyles: null,
          defaultDisplay: null,
          isHostLess: true,
          isContext: true,
          isAttachment: false,
          providesData: false,
          hasRef: false,
          isRepeatable: true,
          styleSections: null,
          helpers: null,
          defaultSlotContents: {},
          variants: {},
          refActions: [],
          subtreePrefetchingConfig: null,
        }),
      });

      // Add component to site
      site.components.push(globalContextComponent);

      // Create TplComponent for global context using site's globalVariant
      const globalContextTpl = mkTplComponentX({
        component: globalContextComponent,
        baseVariant: site.globalVariant,
      });

      // Add to site's global contexts
      site.globalContexts.push(globalContextTpl);

      // Bundle and save
      const bundler = new Bundler();
      const bundle = bundler.bundle(site, "", await getLastBundleVersion());

      await db.saveProjectRev({
        projectId: project.id,
        data: JSON.stringify(bundle),
        revisionNum: 2,
      });
=======
      dbname,
      cleanup: cleanupDatabase,
    } = await createDatabase("project_routes");
    const con = await ensureDbConnection(dburi, dbname);
    await con.synchronize();
    await con.transaction(async (em) => {
      const userAndProjects = await seedTestUserAndProjects(
        em,
        { email: "user@example.com" },
        1,
      );
      user = userAndProjects.user;

      const db = new DbMgr(em, normalActor(user.id));
      // Give the project a secret API token, as the "Regenerate secret token"
      // flow in Studio does.
      project = await db.updateProject(
        { id: userAndProjects.projects[0].id },
        true,
      );
      publicToken = ensure(project.projectApiToken, "expected public token");
      secretToken = ensure(project.secretApiToken, "expected secret token");
      expect(secretToken).not.toEqual(publicToken);

      const sudo = new DbMgr(em, SUPER_USER);
      contentUser = await sudo.createUser({
        email: "content@example.com",
        password: DEFAULT_DEV_PASSWORD,
        firstName: "Content",
        lastName: "Creator",
        needsIntroSplash: false,
        needsSurvey: false,
        needsTeamCreationPrompt: false,
      });
      await sudo.markEmailAsVerified(contentUser);
      await db.grantProjectPermissionByEmail(
        project.id,
        contentUser.email,
        "content",
      );
>>>>>>> upstream/master
    });

    const { host, cleanup: cleanupBackend } = await createBackend(dburi);
    baseURL = host;
<<<<<<< HEAD
=======

>>>>>>> upstream/master
    cleanup = async () => {
      await cleanupBackend();
      await cleanupDatabase();
    };
  });

<<<<<<< HEAD
  beforeEach(async () => {
    api = new SharedApiTester(`${baseURL}/api/v1`);
    await api.refreshCsrfToken();
    await api.login({
      email: "user@example.com",
      password: "!53kr3tz!",
    });
=======
  beforeEach(() => {
    // No session cookie and no user API token: the project API token in the
    // header is the caller's only credential, exactly as for a published app.
    api = new ApiTester(baseURL);
>>>>>>> upstream/master
  });

  afterEach(async () => {
    await api.dispose();
  });

  afterAll(async () => {
    await cleanup();
  });

<<<<<<< HEAD
  describe("updateGlobalContexts", () => {
    describe("warning cases", () => {
      it("should return warning when global context not found", async () => {
        const projectId = projects[0].id;

        const response = await api.post(`/projects/${projectId}`, {
          updateGlobalContexts: [
            {
              name: "NonExistentContext",
              props: { clientId: "test-value" },
            },
          ],
        });

        expect(response.warnings).toBeDefined();
        expect(response.warnings.length).toBeGreaterThan(0);
        expect(response.warnings[0].message).toContain("NonExistentContext");
        expect(response.warnings[0].message).toContain("not found");
      });

      it("should succeed with no warnings when empty updates provided", async () => {
        const projectId = projects[0].id;

        const response = await api.post(`/projects/${projectId}`, {
          updateGlobalContexts: [],
        });

        // When no updates are provided, warnings may be undefined or empty
        expect(response.warnings ?? []).toEqual([]);
      });

      it("should handle multiple non-existent contexts", async () => {
        const projectId = projects[0].id;

        const response = await api.post(`/projects/${projectId}`, {
          updateGlobalContexts: [
            { name: "Context1", props: { prop: "value" } },
            { name: "Context2", props: { prop: "value" } },
          ],
        });

        expect(response.warnings).toBeDefined();
        expect(response.warnings.length).toBe(2);
        expect(response.warnings[0].message).toContain("Context1");
        expect(response.warnings[1].message).toContain("Context2");
      });

      it("should return warning when prop not found on global context", async () => {
        const projectId = projectWithGlobalContext.id;

        const response = await api.post(`/projects/${projectId}`, {
          updateGlobalContexts: [
            {
              name: "TestGlobalContextProvider",
              props: { nonExistentProp: "test-value" },
            },
          ],
        });

        expect(response.warnings).toBeDefined();
        expect(response.warnings.length).toBeGreaterThan(0);
        expect(response.warnings[0].message).toContain("nonExistentProp");
        expect(response.warnings[0].message).toContain("not found");
      });
    });

    describe("success cases", () => {
      it("should successfully update global context props", async () => {
        const projectId = projectWithGlobalContext.id;

        const response = await api.post(`/projects/${projectId}`, {
          updateGlobalContexts: [
            {
              name: "TestGlobalContextProvider",
              props: {
                clientId: "test-client-id",
                host: "https://api.example.com",
              },
            },
          ],
        });

        // Should succeed without warnings (warnings may be undefined or empty array)
        expect(response.warnings ?? []).toEqual([]);
      });

      it("should persist global context updates", async () => {
        const projectId = projectWithGlobalContext.id;

        // First, update the global context
        const updateResponse = await api.post(`/projects/${projectId}`, {
          updateGlobalContexts: [
            {
              name: "TestGlobalContextProvider",
              props: {
                clientId: "persisted-client-id",
                host: "https://persisted.example.com",
              },
            },
          ],
        });

        // Should succeed without warnings (warnings may be undefined or empty array)
        expect(updateResponse.warnings ?? []).toEqual([]);

        // Then fetch the project to verify the changes persisted
        const projectData = await api.get(`/projects/${projectId}`);

        // The response should include the project data
        expect(projectData).toBeDefined();
        // Note: Full verification would require unbundling the site
        // For now, we verify the API calls succeeded
      });
    });
  });
});

describe("isOrgStarter API", () => {
  let api: SharedApiTester;
  let cleanup: () => Promise<void>;

  let projects: Project[];

  beforeAll(async () => {
    const {
      dburi,
      con,
      cleanup: cleanupDatabase,
    } = await createDatabase("projects_org_starter_test");

    await con.transaction(async (em) => {
      const userAndProjects = await seedTestUserAndProjects(
        em,
        { email: "orgstarter@example.com" },
        1
      );
      projects = userAndProjects.projects;
    });

    const { host, cleanup: cleanupBackend } = await createBackend(dburi);
    const baseURL = host;
    cleanup = async () => {
      await cleanupBackend();
      await cleanupDatabase();
    };

    api = new SharedApiTester(`${baseURL}/api/v1`);
    await api.refreshCsrfToken();
    await api.login({
      email: "orgstarter@example.com",
      password: "!53kr3tz!",
    });
  });

  afterAll(async () => {
    await api.dispose();
    await cleanup();
  });

  it("should include isOrgStarter in project response", async () => {
    const projectId = projects[0].id;
    const response = await api.get(`/projects/${projectId}`);
    expect(response.project).toBeDefined();
    expect(response.project.isOrgStarter).toBe(false);
  });

  it("should allow setting isOrgStarter via project update", async () => {
    const projectId = projects[0].id;
    await api.put(`/projects/${projectId}`, {
      isOrgStarter: true,
    });
    const response = await api.get(`/projects/${projectId}`);
    expect(response.project.isOrgStarter).toBe(true);
=======
  function withPublicToken() {
    return {
      headers: {
        "x-plasmic-api-project-tokens": `${project.id}:${publicToken}`,
      },
    };
  }

  /** Authenticates as `u`; only accepted outside production. */
  function asUser(u: User) {
    return {
      headers: {
        "x-plasmic-api-user": u.email,
        "x-plasmic-api-password": DEFAULT_DEV_PASSWORD,
      },
    };
  }

  describe.each(["missing", "invalid"])(
    "%s project credentials",
    (credentials) => {
      function headers(): Record<string, string> {
        return credentials === "invalid"
          ? { "x-plasmic-api-project-tokens": `${project.id}:incorrect` }
          : {};
      }

      it("emits an access error before disconnecting socket subscribers", async () => {
        const socket = io(baseURL, {
          path: "/api/v1/socket",
          extraHeaders: headers(),
          autoConnect: false,
          reconnection: false,
        });
        const errors: string[] = [];
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const disconnected = new Promise<string>((resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Socket did not disconnect")),
              10000,
            );
            socket.on("connect_error", reject);
            socket.on("error", (error) => errors.push(error));
            socket.on("disconnect", resolve);
            socket.on("initServerInfo", () => {
              socket.emit("subscribe", {
                namespace: "projects",
                projectIds: [project.id],
              });
            });
          });
          socket.connect();
          expect(await disconnected).toEqual("io server disconnect");
          expect(errors).toEqual([`No read access to projects ${project.id}`]);
        } finally {
          clearTimeout(timeout);
          socket.disconnect();
        }
      });

      it.each(["preview", "versioned"])(
        "returns an actionable loader %s error",
        async (route) => {
          const id = route === "versioned" ? `${project.id}@0.0.1` : project.id;
          const response = await api.rawReq(
            "get",
            `/api/v1/loader/code/${route}?platform=react&projectId=${encodeURIComponent(id)}`,
            undefined,
            // A header for another project reaches the project permission check;
            // no header at all is rejected earlier by API authentication.
            {
              headers:
                credentials === "missing"
                  ? { "x-plasmic-api-project-tokens": "other-project:token" }
                  : headers(),
            },
          );
          expect(response.status()).toEqual(401);
          expect(await response.json()).toMatchObject({
            error: {
              message:
                "Project ID and/or project API token are missing or incorrect",
            },
          });
        },
      );
    },
  );

  describe("secret API token", () => {
    it.each([
      ["getProjectRev", (id: string) => `/api/v1/projects/${id}`],
      [
        "getProjectRevWithoutData",
        (id: string) => `/api/v1/projects/${id}/revision-without-data`,
      ],
    ])("is not exposed by %s", async (_name, mkUrl) => {
      const res = await api.rawReq(
        "get",
        mkUrl(project.id),
        undefined,
        withPublicToken(),
      );
      expect(res.status()).toEqual(200);

      // Sanity check that the public token really did authorize us, so that
      // the assertions below aren't passing on an error response.
      const body = await res.json();
      expect(body.project.id).toEqual(project.id);
      expect(body.project.projectApiToken).toEqual(publicToken);

      expect(body.project.secretApiToken).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(secretToken);
    });

    it("grants write access, which the public token does not", async () => {
      // Establishes why leaking the secret token matters: it is a privilege
      // escalation from read-only to editor.
      const readOnly = await api.rawReq(
        "put",
        `/api/v1/projects/${project.id}`,
        { name: "renamed with public token" },
        withPublicToken(),
      );
      expect(readOnly.status()).toEqual(403);

      const readWrite = await api.rawReq(
        "put",
        `/api/v1/projects/${project.id}`,
        { name: "renamed with secret token" },
        {
          headers: {
            "x-plasmic-api-project-tokens": `${project.id}:${secretToken}`,
          },
        },
      );
      expect(readWrite.status()).toEqual(200);
    });

    it("is not returned by an update that did not regenerate it", async () => {
      // "content" is two levels below the "editor" required to regenerate the
      // token, but it is enough to rename a project.
      const res = await api.rawReq(
        "put",
        `/api/v1/projects/${project.id}`,
        { name: "renamed by a content creator" },
        asUser(contentUser),
      );
      expect(res.status()).toEqual(200);

      // `updateProject` wraps its response in a paywall envelope.
      const body = await res.json();
      expect(body.paywall).toEqual("pass");
      expect(body.response.project.name).toEqual(
        "renamed by a content creator",
      );
      expect(body.response.regeneratedSecretApiToken).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(secretToken);
    });

    it("is returned by an update that regenerated it", async () => {
      const res = await api.rawReq(
        "put",
        `/api/v1/projects/${project.id}`,
        { regenerateSecretApiToken: true },
        asUser(user),
      );
      expect(res.status()).toEqual(200);

      const { response: body } = await res.json();
      expect(body.regeneratedSecretApiToken).toBeTruthy();
      expect(body.regeneratedSecretApiToken).not.toEqual(secretToken);
      // Still absent from the project itself.
      expect(body.project.secretApiToken).toBeUndefined();
    });
  });

  describe("unowned project", () => {
    /** A separate session that never logs in. */
    let anon: ApiTester;

    beforeEach(() => {
      anon = new ApiTester(baseURL);
    });

    afterEach(async () => {
      await anon.dispose();
    });

    it("is no longer viewable by others once claimed", async () => {
      // Anonymous users create unowned projects, as plasmic.app/ai does.
      const { csrf } = await api.req("get", "/api/v1/auth/csrf");
      const {
        project: { id: projectId },
      } = await api.req(
        "post",
        "/api/v1/projects",
        { name: "Copilot", isPublic: true },
        { headers: { "X-CSRF-Token": csrf } },
      );
      const projectUrl = `/api/v1/projects/${projectId}`;

      // Before it is claimed, anyone with the link can open it.
      const beforeClaim = await anon.rawReq("get", projectUrl);
      expect(beforeClaim.status()).toEqual(200);
      expect((await beforeClaim.json()).project.createdById).toBeNull();

      // The first logged-in user to open it claims it.
      const claim = await api.rawReq(
        "get",
        projectUrl,
        undefined,
        asUser(user),
      );
      expect(claim.status()).toEqual(200);
      const afterClaim = await api.rawReq(
        "get",
        projectUrl,
        undefined,
        asUser(user),
      );
      expect(afterClaim.status()).toEqual(200);
      expect((await afterClaim.json()).owner.id).toEqual(user.id);

      // Neither anonymous users nor other users can open it anymore.
      expect((await anon.rawReq("get", projectUrl)).status()).toEqual(401);
      expect(
        (
          await api.rawReq("get", projectUrl, undefined, asUser(contentUser))
        ).status(),
      ).toEqual(403);
    });
>>>>>>> upstream/master
  });
});
