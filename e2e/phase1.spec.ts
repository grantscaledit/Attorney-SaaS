import { expect, test, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import { DEMO_PASSWORD, DEMO_TOTP } from "./env";

/*
 * Phase 1 in a real browser, on the demo seed (synthetic enquiries pushed
 * through the webhook pipeline): the intake coordinator works the Intake panel
 * and a lead, the top-bar counter links to unanswered leads, and roles hold.
 */

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/sign-in\/verify$/);
  await page.getByLabel("Authentication code").fill(generateSync({ secret: DEMO_TOTP }));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Good");
}

test("intake coordinator works the Intake panel and a lead", async ({ page }) => {
  await signIn(page, "jordan.pike@demo.lexdesk.test");

  await page.getByRole("link", { name: "Intake" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Intake" })).toBeVisible();
  await expect(page.getByText("Missed-call recovery")).toBeVisible();
  await expect(page.getByText("Leads by source")).toBeVisible();

  // The top-bar counter links to leads still waiting for a person.
  await page.getByRole("link", { name: /Unanswered leads/ }).click();
  await expect(page).toHaveURL(/\/intake\/leads\?view=unanswered$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Waiting for a reply from a person",
  );

  await page.goto("/intake/leads?view=missed");
  await page.locator("tbody a").first().click();
  await expect(page.getByText("Lead · Call · missed call")).toBeVisible();
  await expect(page.getByText("A1 · Missed-call text-back")).toBeVisible();
  await expect(page.getByText("Simulated (demo)").first()).toBeVisible();

  // Intake staff cannot manage the GHL connection or approve templates.
  await page.goto("/settings/integrations");
  await expect(page.getByRole("heading", { name: /permission|access/i })).toBeVisible();
  await page.goto("/settings/templates");
  await expect(page.getByRole("button", { name: "Approve this text" })).toHaveCount(0);
});

test("billing staff do not see leads", async ({ page }) => {
  await signIn(page, "priya.raman@demo.lexdesk.test");
  await expect(page.getByRole("link", { name: "Intake" })).toHaveCount(0);
  await page.goto("/intake");
  await expect(page.getByRole("heading", { name: /permission|access/i })).toBeVisible();
});
