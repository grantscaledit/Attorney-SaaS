"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser-side Better Auth client. Same-origin; cookies carry the session. */
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});
