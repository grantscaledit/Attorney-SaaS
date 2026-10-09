"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { THEME_COOKIE, parseTheme, type ThemePreference } from "@/lib/ui/theme";

/** A display preference stored in the browser only; not firm data, so not audited. */
export async function setThemeAction(theme: ThemePreference): Promise<void> {
  const value = parseTheme(theme);
  (await cookies()).set(THEME_COOKIE, value, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
