import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test.setTimeout(150_000);

const NOTICE = "Verify against the source document. The firm's calendar is the system of record.";

/*
 * Phase 4 in a real browser, on the demo seed: the Deadlines panel, an
 * unverified rule that computes nothing until the owner attorney verifies it,
 * and acknowledging an alert.
 */

test("the owner verifies a rule, the probate matter gets its date, and an alert is acknowledged", async ({
  page,
}) => {
  await signIn(page, "scott@demo.lexdesk.test");

  // The top bar counts deadlines in the next 7 days and links to the panel.
  await page.getByRole("link", { name: /Deadlines in 7 days/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Deadlines" })).toBeVisible();
  await expect(page.getByText(NOTICE).first()).toBeVisible();
  await expect(page.getByText("Unacknowledged alerts").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Send the bank statements to the IRS examiner" }).first(),
  ).toBeVisible();

  // The probate matter: the inventory rule is not verified, so no date is computed.
  await page.goto("/matters");
  await page.getByRole("link", { name: "2026-0004" }).click();
  const deadlines = page.locator("#deadlines");
  await expect(deadlines.getByText("Rules not verified: no date computed")).toBeVisible();
  await expect(
    deadlines.getByText(/Inventory, appraisement and list of claims \(from the/),
  ).toBeVisible();
  await expect(deadlines.getByText("Probate milestones (C4)")).toBeVisible();

  // Settings > Deadline rules: verify it against its source.
  await page.getByRole("link", { name: "Deadline rules" }).click();
  await expect(page.getByText("Seed values are not legal advice")).toBeVisible();
  await page.getByRole("link", { name: "Inventory, appraisement and list of claims" }).click();
  await expect(page.getByText("Not verified").first()).toBeVisible();
  await page.getByLabel("Source checked").fill("Checked in the e2e run against the demo source.");
  await page.getByRole("checkbox", { name: /I checked this rule/ }).check();
  await page.getByRole("button", { name: "Verify rule" }).click();
  await expect(page.getByRole("button", { name: "Remove verification" })).toBeVisible();

  // Back on the matter, the date is computed and explained.
  await page.goto("/matters");
  await page.getByRole("link", { name: "2026-0004" }).click();
  const row = page.locator("#deadlines tr", {
    hasText: "Inventory, appraisement and list of claims",
  });
  await expect(row.getByText(/Computed from a verified rule: Trigger date/)).toBeVisible();
  await expect(
    page.locator("#deadlines").getByText("Rules not verified: no date computed"),
  ).toHaveCount(0);

  // The notice matter: acknowledge the alert on the staff deadline due in two days.
  await page.goto("/matters");
  await page.getByRole("link", { name: "2026-0002" }).click();
  const alertRow = page.locator("#deadlines tr", {
    hasText: "Send the bank statements to the IRS examiner",
  });
  await expect(alertRow.getByText("Alert not acknowledged")).toBeVisible();
  await alertRow.getByRole("button", { name: "Acknowledge alert" }).click();
  await expect(alertRow.getByRole("button", { name: "Acknowledge alert" })).toHaveCount(0);
  // The printed CP2000 date carries the rule's cross-check.
  await expect(page.locator("#deadlines").getByText(/Cross-check, CP2000 response/)).toBeVisible();
});

test("a paralegal sees deadlines but cannot verify rules", async ({ page }) => {
  await signIn(page, "maria.delgado@demo.lexdesk.test");
  await page.goto("/settings/deadline-rules");
  await page.getByRole("link", { name: "Federal estate tax return" }).click();
  await expect(page.getByText("Only the owner attorney can change or verify rules.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify rule" })).toHaveCount(0);
  await page.goto("/deadlines");
  await expect(page.getByRole("heading", { level: 1, name: "Deadlines" })).toBeVisible();
});
