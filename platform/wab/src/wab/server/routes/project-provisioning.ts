import { logger } from "@/wab/server/observability";
import { mkApiProject } from "@/wab/server/routes/projects";
import { superDbMgr } from "@/wab/server/routes/util";
import { Request, Response } from "express-serve-static-core";

export async function provisionProject(req: Request, res: Response) {
  const mgr = superDbMgr(req);
  const { name, projectKind, ownerId } = req.body;
  const { workspaceId } = req.params;

  logger().info("Provisioning project", { workspaceId, name, projectKind });

  const { project } = await mgr.createProject({
    name,
    workspaceId,
    ownerId,
    inviteOnly: true,
  });

  if (projectKind) {
    await mgr.updateProjectExtraData(project.id, { projectKind });
  }

  logger().info("Provisioned project", {
    projectId: project.id,
    workspaceId,
    projectKind,
  });

  res.json({ project: mkApiProject(project) });
}

