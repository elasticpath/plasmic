import { addCopilotRoutes, createApp } from "@/wab/server/AppServer";
import { Config } from "@/wab/server/config";
import { ensureDbConnections } from "@/wab/server/db/DbCon";
import { runExpressApp, setupServerCli } from "@/wab/server/server-common";
import "core-js";

async function runAppServer(config: Config) {
  await ensureDbConnections(config.databaseUri);

  const { app } = await createApp("copilot", config, addCopilotRoutes);
  return runExpressApp(app);
}

export async function copilotBackendMain() {
  const { opts, config } = setupServerCli();
  await runAppServer(config);
}
