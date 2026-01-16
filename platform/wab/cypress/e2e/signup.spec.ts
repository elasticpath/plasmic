import { v4 } from "uuid";

describe("Signup flow", function () {
  it("rejects signup without an invitation", function () {
    const randomUserId = v4();
    const randomUserEmail = `fakeuser+${randomUserId}@gmail.com`;

    // Navigate to login page
    cy.visit("/login");

    // Switch to signup form
    cy.contains("Create account", { timeout: 120000 }).click();

    // Fill signup form
    cy.get("input[name=email]").type(randomUserEmail);
    cy.get("input[name=password]").type("!53kr3tz!");
    cy.get("input[name=firstName]").type("Fakey");
    cy.get("input[name=lastName]").type("Fake");
    cy.get("button[type=submit]:contains(Sign up)").click();

    // Verify rejection message is shown
    cy.contains("Please use a valid email address.", { timeout: 10000 });
  });
});
