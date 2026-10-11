import { expect, test } from "@playwright/test";
import { textPdf } from "../db/seed/text-pdf";
import { signIn } from "./sign-in";

test.setTimeout(150_000);

/*
 * Phase 3 in a real browser, on the demo seed: a portal client sees only
 * their own matter, uploads a requested document and saves the questionnaire;
 * the owner works a triaged IRS notice and sees the Pipeline panel.
 */

test("a client uses the portal and cannot reach the staff app", async ({ page }) => {
  await signIn(page, "jamie.rivera@demo-client.example.test");
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your matters" })).toBeVisible();
  const matters = page.locator("main li a");
  await expect(matters).toHaveCount(1);
  await matters.first().click();
  await expect(page.getByText("Where your matter stands")).toBeVisible();

  // Upload a requested document to its checklist item.
  const upload = page.getByLabel("Upload: Existing will, trust or powers of attorney");
  await upload.setInputFiles({
    name: "old will.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(textPdf([["LAST WILL AND TESTAMENT OF JAMIE RIVERA", "Signed in 2009."]])),
  });
  await upload.locator("xpath=following-sibling::button").click();
  // The item now shows as received, and the file is listed under the client's documents.
  const item = page.locator("li", { hasText: "Existing will, trust or powers of attorney" });
  await expect(item.getByText("Received", { exact: true })).toBeVisible();
  await expect(page.getByText("Sent by you").first()).toBeVisible();

  await page.getByRole("link", { name: "Continue the questionnaire" }).click();
  await page
    .getByLabel("Who should make medical decisions if you cannot (medical power of attorney)?")
    .fill("Sam Rivera");
  await page.getByRole("button", { name: "Save and finish later" }).click();
  await expect(page.getByText(/Saved. You can come back/)).toBeVisible();

  // The staff app is not for clients.
  await page.goto("/matters");
  await expect(page).toHaveURL(/\/portal$/);
  await page.goto("/approvals");
  await expect(page).toHaveURL(/\/portal$/);
});

test("the owner confirms a triaged IRS notice and sees the pipeline", async ({ page }) => {
  await signIn(page, "scott@demo.lexdesk.test");
  await page.getByRole("link", { name: "Matters" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Matters" })).toBeVisible();
  await page.getByRole("link", { name: "2026-0002" }).click();
  await expect(page.getByText("Notice triage (B3)")).toBeVisible();
  await expect(page.getByText("IRS notice CP2000 2024 - 2026-0002.pdf")).toBeVisible();
  await expect(
    page
      .getByText("Verify against the source document. The firm's calendar is the system of record.")
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel("Respond by")).toHaveValue("2026-10-30");
  await page.getByRole("button", { name: "Confirm fields" }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Pipeline" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();
  await expect(page.getByText("Past stage threshold").first()).toBeVisible();
  await expect(page.getByText("Unsigned engagement letters")).toBeVisible();
});
