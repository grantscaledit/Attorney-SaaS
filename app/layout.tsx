import "@fontsource-variable/source-serif-4/index.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_COOKIE, parseTheme } from "@/lib/ui/theme";

export const metadata: Metadata = {
  title: { default: "LexDesk", template: "%s · LexDesk" },
  description: "Law firm operations",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0d" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Theme comes from a cookie so the server renders the right mode with no flash or inline script.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme} suppressHydrationWarning>
      <body className="min-h-dvh">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
