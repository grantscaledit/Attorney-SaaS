import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test.setTimeout(150_000);

/*
 * Phase 2 in a real browser, on the demo seed (six text conversations run
 * through the real A3 job with demo mode's rule-based model): the owner works
 * the approval queue and a conflict pre-screen; a paralegal can see but not
 * clear a conflict.
 */

test("owner works the approval queue and clears a conflict pre-screen", async ({ page }) => {
  await signIn(page, "scott@demo.lexdesk.test");

  await page.getByRole("link", { name: "Approvals" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Approvals" })).toBeVisible();
  // The levy escalation is urgent and the advice request waits for a person.
  await expect(page.getByText("Take over the conversation: Levy")).toBeVisible();
  await expect(page.getByText("Take over the conversation: Asked for legal advice")).toBeVisible();
  await expect(page.getByText(/Refer out to Hannah Reyes/)).toBeVisible();

  // Edit and approve one assistant reply; it goes to the outbox (simulated in the demo).
  const replies = page.locator("section", {
    hasText: "Reply to an enquiry (intake assistant, turn 1)",
  });
  const before = await replies.count();
  const reply = replies.first();
  await reply.getByRole("button", { name: "Edit" }).click();
  await reply.getByRole("textbox").first().fill("Thank you. Which agency sent the notice?");
  await reply.getByRole("button", { name: "Approve edited text" }).click();
  await expect(replies).toHaveCount(before - 1);
  await page.goto("/approvals?view=decided");
  await expect(page.getByText("Approved with edits")).toBeVisible();
  await page.goto("/approvals");

  // The brief links to Owen Pryce's lead, where the pre-screen found a similar adverse party.
  await page.getByRole("link", { name: "Owen Pryce" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Owen Pryce" })).toBeVisible();
  await expect(page.getByText("Conflict pre-screen (A6)")).toBeVisible();
  await expect(page.getByText("Owen Price")).toBeVisible();
  await expect(page.getByText("Awaiting a lawyer's review")).toBeVisible();
  await page
    .getByLabel("Review note")
    .fill("Different person: different city and date of birth on file.");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  // The page now shows the decision and the note in place of the review form.
  await expect(page.getByText("Cleared", { exact: true })).toBeVisible();
  await expect(page.getByText(/Different person: different city/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);

  await page.goto("/settings/ai");
  await expect(page.getByText("Review every reply.")).toBeVisible();
  await expect(page.getByText("intake.pre_consult_brief")).toBeVisible();
});

test("a paralegal sees the pre-screen but cannot clear it or decline a lead", async ({ page }) => {
  await signIn(page, "maria.delgado@demo.lexdesk.test");
  await page.goto("/approvals");
  await page.getByRole("link", { name: "Theo Brandt" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Theo Brandt" })).toBeVisible();
  await expect(page.getByText("Outside the firm's practice areas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Decline this lead" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
});
