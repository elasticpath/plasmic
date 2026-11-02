// tslint:disable:ordered-imports
<<<<<<< HEAD
import "@/wab/server/instrument";
=======
import "@/wab/server/observability/setup";
>>>>>>> upstream/master
import "@/wab/server/integrations-backend-real";
import { spawn } from "@/wab/shared/common";
import { serverDataBackendMain } from "@/wab/server/integrations-backend-real";
if (require.main === module) {
  spawn(serverDataBackendMain());
}
