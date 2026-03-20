import { addLoaderRoutes, createApp } from "@/wab/server/AppServer";
import { Config } from "@/wab/server/config";
import { ensureDbConnections } from "@/wab/server/db/DbCon";
import { runExpressApp, setupServerCli } from "@/wab/server/server-common";
import { spawn } from "@/wab/shared/common";
import "core-js";

async function runAppServer(config: Config) {
  await ensureDbConnections(config.databaseUri);
  const { app } = await createApp("loader", config, addLoaderRoutes, undefined, { skipSession: true });
  return runExpressApp(app);
}

export async function loaderBackendMain() {
  const { config } = setupServerCli();
  await runAppServer(config);
}

if (require.main === module) {
  spawn(loaderBackendMain());
}
