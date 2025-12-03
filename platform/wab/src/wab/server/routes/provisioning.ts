import { mkApiTeam } from "@/wab/server/routes/teams";
import { superDbMgr, userDbMgr } from "@/wab/server/routes/util";
import { mkApiWorkspace } from "@/wab/server/routes/workspaces";
import {
  CreateTeamResponse,
  CreateWorkspaceResponse,
} from "@/wab/shared/ApiSchema";
import { ensureType } from "@/wab/shared/common";
import { Request, Response } from "express-serve-static-core";

export async function provisionUser(req: Request, res: Response) {
  const mgr = superDbMgr(req);
  const user = await mgr.provisionUser(req.body);
  res.json({ user });
}

export async function provisionTeam(req: Request, res: Response) {
  const mgr = superDbMgr(req);
  const team = await mgr.provisionTeam(req.body);
  const apiTeam = mkApiTeam(team);

  res.json(ensureType<CreateTeamResponse>({ team: apiTeam }));
}

export async function provisionWorkspace(req: Request, res: Response) {
  const mgr = superDbMgr(req);
  const workspace = await mgr.provisionWorkspace(req.body);
  const apiWorkspace = mkApiWorkspace(workspace);

  res.json(ensureType<CreateWorkspaceResponse>({ workspace: apiWorkspace }));
}

export async function grantTeamUserPermissions(req: Request, res: Response) {
  const mgr = superDbMgr(req);
  const perm = await mgr.grantTeamUserPermissions({
    teamId: req.params.teamId,
    ...req.body,
  });

  res.json({ perm });
}

export async function grantWorkspaceUserPermissions(req: Request, res: Response) {
  const mgr = superDbMgr(req);
  const perm = await mgr.grantWorkspaceUserPermissions({
    workspaceId: req.params.workspaceId,
    ...req.body,
  });

  res.json({ perm });
}