// tslint:disable:ordered-imports
import "./instrument";
import { spawn } from "@/wab/shared/common";
import { appBackendMain } from "@/wab/server/app-backend-real";

if (require.main === module) {
  spawn(appBackendMain());
}
