// newrelic must be imported as early as possible, so we shift config loading to
// the top so that we know if we are running production and want newrelic.
import { addImgOptimizerRoutes, createApp } from "@/wab/server/AppServer";
import { Config } from "@/wab/server/config";
import { ensureDbConnections } from "@/wab/server/db/DbCon";
import { runExpressApp, setupServerCli } from "@/wab/server/server-common";
import "core-js";

async function runImgOptimizerServer(config: Config) {
  await ensureDbConnections(config.databaseUri);
  
  const { app } = await createApp("img-optimizer", config, addImgOptimizerRoutes);
  return runExpressApp(app);
}

export async function imgOptimizerBackendMain() {
  const { config } = setupServerCli();
  await runImgOptimizerServer(config);
}