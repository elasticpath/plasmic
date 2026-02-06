import { addLoaderHtmlRoutes, createApp } from "@/wab/server/AppServer";
import { Config } from "@/wab/server/config";
import { ensureDbConnections } from "@/wab/server/db/DbCon";
import { runExpressApp, setupServerCli } from "@/wab/server/server-common";
import { spawn } from "@/wab/shared/common";
import "core-js";

async function runAppServer(config: Config) {
  await ensureDbConnections(config.databaseUri);
  const { app } = await createApp("loader-html", config, addLoaderHtmlRoutes);
  return runExpressApp(app);
}

export async function loaderHtmlBackendMain() {
  const { config } = setupServerCli();
  await runAppServer(config);
}

if (require.main === module) {
  spawn(loaderHtmlBackendMain());
}
