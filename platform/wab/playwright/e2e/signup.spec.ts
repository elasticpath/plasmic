import { v4 } from "uuid";
import { test } from "../fixtures/test";

test.describe("Signup flow", () => {
  test("rejects signup without an invitation", async ({ page }) => {
    const randomUserId = v4();
    const randomUserEmail = `fakeuser+${randomUserId}@gmail.com`;

    // Navigate to login page
    await page.goto("/login");

    // Switch to signup form
    await page.getByText("Create account").click({ timeout: 120000 });

    // Fill signup form
    await page.locator('input[name="email"]').fill(randomUserEmail);
    await page.locator('input[name="password"]').fill("!53kr3tz!");
    await page.locator('input[name="firstName"]').fill("Fakey");
    await page.locator('input[name="lastName"]').fill("Fake");
    await page.locator('button[type="submit"]').getByText("Sign up").click();

    // Verify rejection message is shown
    await page
      .getByText("Please use a valid email address.")
      .waitFor({ timeout: 10000 });
  });
});
