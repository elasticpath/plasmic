// tslint:disable:ordered-imports
import { spawn } from "@/wab/shared/common";
import { imgOptimizerBackendMain } from "@/wab/server/img-optimizer-backend-real";

if (require.main === module) {
  spawn(imgOptimizerBackendMain());
}