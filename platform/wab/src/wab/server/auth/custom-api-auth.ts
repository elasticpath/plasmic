import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { UnauthorizedError } from "@/wab/shared/ApiErrors/errors";
import { getUser, superDbMgr } from "@/wab/server/routes/util";
import { doLogin } from "@/wab/server/auth/util";
import { logger } from "@/wab/server/observability";
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
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDOiz4gNCAgA6mlvpIx5aLFtsI0zl\n" +
    "D+x6433sySW5w2CGGSy1HVuOpdksNN/3kgsy77YL1QghUjZ+WEJZx0K2QQ==\n" +
    "-----END PUBLIC KEY-----";

  try {
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
      // Must match all cookie attributes from external-provisioner for browser to delete it
      res.clearCookie("cms_auth_token", {
        domain: "elasticpath.com",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });

      next();
    });
  } catch (err) {
    logger().warn(`Failed to verify JWT in cookie: ${err}`);
    throw new UnauthorizedError(`Invalid authentication token`);
  }
}
