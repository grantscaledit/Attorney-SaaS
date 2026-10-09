import { expect, test, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import { DEMO_PASSWORD, DEMO_TOTP } from "./env";

/*
 * Phase 0 in a real browser: MFA sign-in, inviting a user, the invitee's
 * password and authenticator enrollment, role enforcement, and the audit trail.
 */

const OWNER = "scott@demo.lexdesk.test";
const NEW_PASSWORD = "correct horse battery staple, e2e";

/** TOTP codes are single-use per 30s window; wait for a fresh window when needed. */
async function freshCode(secret: string, used: Set<string>): Promise<string> {
  for (;;) {
    const code = generateSync({ secret });
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const usedOwnerCodes = new Set<string>();

async function signInOwner(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(OWNER);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/sign-in\/verify$/);
  await page.getByLabel("Authentication code").fill(await freshCode(DEMO_TOTP, usedOwnerCodes));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Scott");
}

test("unauthenticated visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/settings/users");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("wrong TOTP code is rejected", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(OWNER);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Authentication code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "not valid" })).toBeVisible();
});

test("invite, enroll, enforce role, and audit", async ({ page, browser }) => {
  await signInOwner(page);
  await expect(page.getByText("Siekierski Law").first()).toBeVisible();

  // Solo plan is full (5 of 5): free a seat by deactivating the pending invitee.
  await page.goto("/settings/users");
  await page.getByRole("button", { name: "Actions for Evan Brooks" }).click();
  await page.getByRole("menuitem", { name: "Deactivate" }).click();
  await page.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByText("User deactivated and signed out.")).toBeVisible();

  await page.getByRole("button", { name: "Invite user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Casey Morgan");
  await dialog.getByLabel("Work email").fill("casey.morgan@demo.lexdesk.test");
  await dialog.getByLabel("Role").selectOption("paralegal");
  await dialog.getByRole("button", { name: "Create setup link" }).click();
  const link = await dialog.getByLabel("Setup link").inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);
  await dialog.getByRole("button", { name: "Done" }).click();

  // The invitee, in a separate browser.
  const ctx = await browser.newContext();
  const invitee = await ctx.newPage();
  await invitee.goto(link);
  await invitee.getByLabel("New password").fill(NEW_PASSWORD);
  await invitee.getByLabel("Confirm password").fill(NEW_PASSWORD);
  await invitee.getByRole("button", { name: "Set password" }).click();
  await expect(invitee).toHaveURL(/\/sign-in\?reason=welcome/);

  await invitee.getByLabel("Password").fill(NEW_PASSWORD);
  await invitee.getByRole("button", { name: "Continue" }).click();
  // MFA is mandatory: the first stop after sign-in is enrollment.
  await expect(invitee).toHaveURL(/\/setup\/mfa$/);
  await invitee.getByLabel("Confirm your password").fill(NEW_PASSWORD);
  await invitee.getByRole("button", { name: "Continue" }).click();
  const key = await invitee.getByLabel("Setup key").inputValue();
  await invitee.getByLabel("6-digit code from the app").fill(generateSync({ secret: key }));
  await invitee.getByRole("button", { name: "Verify and turn on" }).click();
  await expect(invitee.getByText("Two-step verification is on.")).toBeVisible();
  await invitee.getByLabel("I have stored these codes somewhere safe.").check();
  await invitee.getByRole("button", { name: "Continue to LexDesk" }).click();
  await expect(invitee.getByRole("heading", { level: 1 })).toContainText("Casey");

  // Role enforcement: a paralegal has no audit log access, in navigation or by URL.
  await expect(invitee.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await invitee.goto("/audit");
  await expect(
    invitee.getByRole("heading", { name: "You don't have access to this page" }),
  ).toBeVisible();
  await ctx.close();

  // The owner sees every step in the audit log.
  await page.goto("/audit?q=casey.morgan");
  const table = page.getByRole("table");
  for (const label of ["Invitation accepted", "MFA enabled", "Signed in", "Access denied"]) {
    await expect(table.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Verify chain" }).click();
  await expect(page.getByText(/Chain intact/)).toBeVisible();
});
