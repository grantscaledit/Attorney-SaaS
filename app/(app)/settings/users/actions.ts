"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import {
  issueUserSetupLink,
  resetUserMfa,
  revokeUserSessions,
} from "@/modules/users/commands/access";
import { inviteUser } from "@/modules/users/commands/invite";
import { deactivateUser, reactivateUser } from "@/modules/users/commands/set-status";
import { updateUser } from "@/modules/users/commands/update";

type LinkResult = { setupUrl: string; expiresAt: Date };

function done<T>(result: ActionState<T>): ActionState<T> {
  if (result.status === "success") revalidatePath("/settings/users");
  return result;
}

export async function inviteUserAction(
  _prev: ActionState<LinkResult>,
  form: FormData,
): Promise<ActionState<LinkResult>> {
  return done(
    await runCommand(inviteUser, {
      name: form.get("name"),
      email: form.get("email"),
      role: form.get("role"),
      title: form.get("title") || undefined,
    }),
  );
}

export async function updateUserAction(
  _prev: ActionState<unknown>,
  form: FormData,
): Promise<ActionState<unknown>> {
  return done(
    await runCommand(
      updateUser,
      {
        userId: form.get("userId"),
        name: form.get("name"),
        role: form.get("role"),
        title: form.get("title") || undefined,
      },
      { successMessage: "Saved." },
    ),
  );
}

export async function issueSetupLinkAction(userId: string): Promise<ActionState<LinkResult>> {
  return done(await runCommand(issueUserSetupLink, { userId }));
}

export async function deactivateUserAction(userId: string): Promise<ActionState<unknown>> {
  return done(
    await runCommand(
      deactivateUser,
      { userId },
      { successMessage: "User deactivated and signed out." },
    ),
  );
}

export async function reactivateUserAction(userId: string): Promise<ActionState<unknown>> {
  return done(
    await runCommand(reactivateUser, { userId }, { successMessage: "User reactivated." }),
  );
}

export async function resetMfaAction(userId: string): Promise<ActionState<unknown>> {
  return done(
    await runCommand(
      resetUserMfa,
      { userId },
      { successMessage: "MFA reset. They will enroll a new authenticator at next sign-in." },
    ),
  );
}

export async function revokeSessionsAction(userId: string): Promise<ActionState<unknown>> {
  return done(
    await runCommand(revokeUserSessions, { userId }, { successMessage: "All sessions ended." }),
  );
}
