// tslint:disable:ordered-imports
<<<<<<< HEAD
import "@/wab/server/instrument";
=======
import "@/wab/server/observability/setup";
>>>>>>> upstream/master
import { spawn } from "@/wab/shared/common";
import { codegenBackendMain } from "@/wab/server/codegen-backend-real";
import { maybeStartGoogleCloudProfiler } from "@/wab/server/util/profiler";

if (require.main === module) {
  spawn(maybeStartGoogleCloudProfiler());
  spawn(codegenBackendMain());
}
