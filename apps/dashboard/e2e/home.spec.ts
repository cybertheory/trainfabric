import { test, expect } from "@playwright/test";

// `/` is the marketing landing page. App routes under (app) are behind
// auth.protect() when Clerk server keys are set, so they aren't asserted here.
test("landing renders the brand hero", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Collaborative Autoresearch");
});
