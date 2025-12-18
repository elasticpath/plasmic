import { Config } from "@/wab/server/config";
import { DbMgr } from "@/wab/server/db/DbMgr";
import passport from "passport";
import { asyncToCallback } from "@/wab/shared/common";
import { superDbMgr } from "@/wab/server/routes/util";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";

export async function setupCustomPassport(dbMgr: DbMgr, config: Config) {

  // JWT for provisioning
  passport.use(
    "provision-jwt",
    new JwtStrategy(
      {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey:
          "-----BEGIN PUBLIC KEY-----\n" +
          "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvAnj5ENp4CVKULbrSPD36WZyeOZV\n" +
          "+J0SMo6743PmcvvZkjmm6SXLmV0Dv8HqOXDA1c7YkuRFp7QueT5RZEz4oQ==\n" +
          "-----END PUBLIC KEY-----",
        algorithms: ["ES256"],
        passReqToCallback: true,
      },
      (req, jwt_payload, done) => {
        asyncToCallback(done, async () => {
          const mgr = superDbMgr(req);
          const user = await mgr.tryGetUserByEmail(jwt_payload.sub);

          if (!user) {
            return false;
          }

          return user;
        });
      }
    )
  );
}
