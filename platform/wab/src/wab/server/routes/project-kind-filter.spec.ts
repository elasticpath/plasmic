import { Project } from "@/wab/server/entities/Entities";
import { filterProjectsByKind } from "@/wab/server/routes/project-kind-filter";

function makeProject(
  id: string,
  projectKind?: string
): Project {
  return {
    id,
    extraData: projectKind ? { projectKind } : null,
  } as unknown as Project;
}

describe("filterProjectsByKind", () => {
  const standard = makeProject("p1");
  const storefront = makeProject("p2");
  const commerceManager = makeProject("p3", "commerce-manager");
  const dashboard = makeProject("p4", "dashboard");

  const allProjects = [standard, storefront, commerceManager, dashboard];

  it("returns all projects when excludeKinds is undefined", () => {
    expect(filterProjectsByKind(allProjects, undefined)).toEqual(allProjects);
  });

  it("returns all projects when excludeKinds is empty string", () => {
    expect(filterProjectsByKind(allProjects, "")).toEqual(allProjects);
  });

  it("excludes projects matching a single kind", () => {
    const result = filterProjectsByKind(allProjects, "commerce-manager");
    expect(result).toEqual([standard, storefront, dashboard]);
  });

  it("excludes projects matching multiple comma-separated kinds", () => {
    const result = filterProjectsByKind(
      allProjects,
      "commerce-manager,dashboard"
    );
    expect(result).toEqual([standard, storefront]);
  });

  it("treats projects with no projectKind as 'standard'", () => {
    const result = filterProjectsByKind(allProjects, "standard");
    expect(result).toEqual([commerceManager, dashboard]);
  });

  it("returns all projects when excludeKinds matches nothing", () => {
    const result = filterProjectsByKind(allProjects, "nonexistent");
    expect(result).toEqual(allProjects);
  });

  it("handles empty project list", () => {
    expect(filterProjectsByKind([], "commerce-manager")).toEqual([]);
  });
});
