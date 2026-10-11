import { expect, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import { DEMO_PASSWORD, DEMO_TOTP } from "./env";

/**
 * Signs a demo account in with password and TOTP. The specs run in one
 * worker from one IP, so they can reach the sign-in rate limit (5 a minute);
 * when that happens this waits out the window, as a person would, rather
 * than loosening the limit for tests.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();
    const limited = page.getByText("Too many attempts");
    await expect(page.getByLabel("Authentication code").or(limited)).toBeVisible();
    if (await limited.isVisible()) {
      if (attempt >= 1) throw new Error("still rate limited after waiting a full window");
      await page.waitForTimeout(61_000);
      continue;
    }
    break;
  }
  await expect(page).toHaveURL(/\/sign-in\/verify$/);
  await page.getByLabel("Authentication code").fill(generateSync({ secret: DEMO_TOTP }));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}
