import { recordAuditExport } from "@/modules/audit/commands/record-export";
import { verifyChain } from "@/modules/audit/commands/verify-chain";
import { bootstrapFirm } from "@/modules/firm/commands/bootstrap";
import { setFeatureEnabled } from "@/modules/firm/commands/set-feature";
import { updateFirmSettings } from "@/modules/firm/commands/update-settings";
import { acceptInvite } from "@/modules/users/commands/accept-invite";
import {
  issueUserSetupLink,
  resetUserMfa,
  revokeUserSessions,
} from "@/modules/users/commands/access";
import { inviteUser } from "@/modules/users/commands/invite";
import { deactivateUser, reactivateUser } from "@/modules/users/commands/set-status";
import { updateUser } from "@/modules/users/commands/update";
import type { AnyCommand } from "./define";

/**
 * Every command in the system. tests/integration/commands-audited.test.ts runs
 * each one and fails if any is missing a fixture or does not write an audit row.
 */
export const COMMANDS = [
  bootstrapFirm,
  updateFirmSettings,
  setFeatureEnabled,
  inviteUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  issueUserSetupLink,
  resetUserMfa,
  revokeUserSessions,
  acceptInvite,
  verifyChain,
  recordAuditExport,
] as const satisfies readonly AnyCommand[];
