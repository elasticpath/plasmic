import {
  addDatadogErrorHandler,
  addDatadogMiddleware,
  addEndErrorHandlers,
  addImgOptimizerRoutes,
  addLoggingMiddleware,
} from "@/wab/server/AppServer";
import { Config } from "@/wab/server/config";
import { runExpressApp, setupServerCli } from "@/wab/server/server-common";
import { NotFoundError } from "@/wab/shared/ApiErrors/errors";
import "core-js";
import express from "express";

export function createImgOptimizerApp(config: Config) {
  const app = express();

  app.set("port", config.port || process.env.BACKEND_PORT || 3004);
  app.set("name", "img-optimizer");
  app.disable("x-powered-by");

  if (config.production) {
    // Behind the load balancer; without this every client shares one req.ip
    // and one rate-limit bucket.
    app.enable("trust proxy");
  }

  addDatadogMiddleware(app);
  addLoggingMiddleware(app);
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("X-Frame-Options", "DENY");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  addImgOptimizerRoutes(app);
  app.use((_req, _res, next) => next(new NotFoundError("Not Found")));
  addDatadogErrorHandler(app);
  addEndErrorHandlers(app);

  return app;
}

export async function imgOptimizerBackendMain() {
  const { config } = setupServerCli();
  return runExpressApp(createImgOptimizerApp(config));
}
