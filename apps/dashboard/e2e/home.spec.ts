import { test, expect } from "@playwright/test";

test("home renders datasets heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Datasets" })).toBeVisible();
});
