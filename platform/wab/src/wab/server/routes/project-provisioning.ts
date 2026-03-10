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

export async function grantProjectUserPermissions(req: Request, res: Response) {
  const mgr = superDbMgr(req);
  const { projectId } = req.params;
  const { userId, accessLevel } = req.body;

  logger().info("Granting project permissions", {
    projectId,
    userId,
    accessLevel,
  });

  const user = await mgr.getUserById(userId);
  const perm = await mgr.grantProjectPermissionByEmail(
    projectId,
    user.email,
    accessLevel
  );

  logger().info("Granted project permissions", {
    projectId,
    userId,
    accessLevel: perm.accessLevel,
  });

  res.json({ perm });
}
