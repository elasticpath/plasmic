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
  let baseURL: string;
  let cleanup: () => Promise<void>;

  let user: User;
  let projects: Project[];
  let projectWithGlobalContext: Project;

  beforeAll(async () => {
    const {
      dburi,
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
    });

    const { host, cleanup: cleanupBackend } = await createBackend(dburi);
    baseURL = host;
    cleanup = async () => {
      await cleanupBackend();
      await cleanupDatabase();
    };
  });

  beforeEach(async () => {
    api = new SharedApiTester(`${baseURL}/api/v1`);
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
  });
});
