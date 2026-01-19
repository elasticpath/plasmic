import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getUser, superDbMgr } from "@/wab/server/routes/util";
import { doLogin } from "@/wab/server/auth/util";
import { logger } from "@/wab/server/observability";
import { ensureType } from "@/wab/shared/common";
import { LoginResponse } from "@/wab/shared/ApiSchema";
import { DbMgr, SUPER_USER } from "@/wab/server/db/DbMgr";
import { getManager } from "typeorm";


/**
 * Checks if request is using a Team API token, acting on behalf of
 * a specific user.  Populates req.apiTeam and req.user if so.
 */
export async function customTeamApiUserAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  next();
}

/**
 * Checks if request is using a Team API token. Populates
 * req.apiTeam if so.
 */
export async function customTeamApiAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  next();
}

export async function customEPCCCookieAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {

  if (req.user) {
    return next();
  }

  const token = req.cookies?.cms_auth_token;
  if (!token) {
    return next();
  }

  const cookieAuthPublicKey =
    "-----BEGIN PUBLIC KEY-----\n" +
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEcAGT3GFmG0zKsklK2LGaJMRmd+MJ\n" +
    "e5JRbEppIloKrZ22/IxiAFzscmzBER6F7vNNO5hYxKO1ISB+IXmC+OsTqQ==\n" +
    "-----END PUBLIC KEY-----";

  const payload = jwt.verify(token, cookieAuthPublicKey, {
    algorithms: ["ES256"],
    issuer: "cm.elasticpath.com",
    audience: "cms.elasticpath.com",
  }) as jwt.JwtPayload;

  if (!payload.sub) {
    return next();
  }

  const mgr = new DbMgr(getManager(), SUPER_USER);
  const user = await mgr.tryGetUserById(payload.sub);

  if (!user) {
    return next();
  }

  doLogin(req, user, (err2) => {
    if (err2) {
      return next(err2);
    }
    logger().info(
      `logged in as ${getUser(req, { allowUnverifiedEmail: true }).email}`
    );

    // One-time use: clear it after session mint
    res.clearCookie("cms_auth_token", { path: "/" });

    next();
  });
}
