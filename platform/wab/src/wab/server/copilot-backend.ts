// tslint:disable:ordered-imports
import { spawn } from "@/wab/shared/common";
import { copilotBackendMain } from "@/wab/server/copilot-backend-real";

if (require.main === module) {
  spawn(copilotBackendMain());
}
