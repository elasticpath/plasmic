import { getEnvVar } from "../../env";
import { test } from "../../fixtures";
import {
  NextJsContext,
  setupNextJs,
  teardownNextJs,
} from "../../nextjs/nextjs-setup";
import { testWordpressLoader } from "./shared/test-wordpress";

test.describe(`NextJS WordPress`, () => {
  let ctx: NextJsContext;

  test.beforeAll(async () => {
    ctx = await setupNextJs({
      bundleFile: "wordpress.json",
      projectName: "WordPress Project",
      npmRegistry: getEnvVar("NPM_CONFIG_REGISTRY"),
      codegenHost: getEnvVar("WAB_HOST"),
      removeComponentsPage: true,
    });
  });

  test.afterAll(async () => {
    await teardownNextJs(ctx);
  });

  test(`should work with WordPress posts`, async ({ page }) => {
    await testWordpressLoader(page, ctx.host);
  });
});
