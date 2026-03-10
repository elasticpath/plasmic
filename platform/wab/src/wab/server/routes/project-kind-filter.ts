import { Project } from "@/wab/server/entities/Entities";

/**
 * Filters projects by excluding specified projectKinds.
 * If no excludeKinds provided, returns all projects unchanged.
 */
export function filterProjectsByKind(
  projects: Project[],
  excludeKinds?: string
): Project[] {
  if (!excludeKinds) return projects;
  const kinds = excludeKinds.split(",");
  return projects.filter(
    (p) => !kinds.includes(p.extraData?.projectKind ?? "standard")
  );
}
