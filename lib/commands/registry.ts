import { recordAuditExport } from "@/modules/audit/commands/record-export";
import { verifyChain } from "@/modules/audit/commands/verify-chain";
import { bootstrapFirm } from "@/modules/firm/commands/bootstrap";
import { ingestGhlWebhook } from "@/modules/ghl/commands/ingest-webhook";
import {
  markGhlWebhookFailed,
  processGhlWebhook,
  retryGhlWebhook,
} from "@/modules/ghl/commands/process-webhook";
import {
  reconcileGhlBatch,
  recordSyncRun,
  requestReconcile,
} from "@/modules/ghl/commands/reconcile";
import { claimMessage, markStaleSend, recordSendResult } from "@/modules/messaging/commands/outbox";
import {
  approveMessageTemplate,
  saveMessageTemplate,
  withdrawTemplateApproval,
} from "@/modules/messaging/commands/templates";
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
import { recordAiRun } from "@/modules/ai/commands/record-run";
import { decideApproval } from "@/modules/approvals/commands/decide";
import { updateAiSettings } from "@/modules/firm/commands/ai-settings";
import { a3Handoff, a3Skipped, a3Turn } from "@/modules/intake/commands/a3";
import {
  addConflictParties,
  removeConflictParty,
  rerunConflictCheck,
  reviewConflictCheck,
} from "@/modules/intake/commands/conflicts";
import {
  a10Enroll,
  a11Cold,
  a8Brief,
  declineLead,
  referLead,
  removeReferralPartner,
  saveReferralPartner,
} from "@/modules/intake/commands/followups";
import { updateIntakeProfile } from "@/modules/users/commands/intake-profile";
import {
  applyProcessing,
  confirmExtraction,
  logDownload,
  recordUpload,
  setDocumentType,
  shareDocument,
} from "@/modules/documents/commands/documents";
import { updateEngagementTemplate } from "@/modules/firm/commands/engagement-template";
import {
  draftEngagement,
  markEngagementSigned,
  sendEngagementReminders,
  withdrawEngagement,
} from "@/modules/matters/commands/engagements";
import {
  applyDraft,
  chaseDocuments,
  closeMatter,
  draftStatusUpdate,
  flagStalled,
  saveQuestionnaire,
} from "@/modules/matters/commands/lifecycle";
import {
  addNote,
  addParty,
  assignMatter,
  changeStage,
  createTask,
  openMatter,
  reissuePortalLink,
  removeParty,
  setTaskStatus,
} from "@/modules/matters/commands/matters";
import { applySummary } from "@/modules/matters/commands/summary";
import {
  escalateDeadlineAlerts,
  runDeadlineAudit,
  runDeadlinesDaily,
} from "@/modules/deadlines/commands/automations";
import { createCalendarFeed, revokeCalendarFeed } from "@/modules/deadlines/commands/calendar";
import {
  acknowledgeAlerts,
  addDeadline,
  addTolling,
  assignDeadline,
  endPaymentPlan,
  moveDeadline,
  recordEvent,
  removeEvent,
  removeTolling,
  setDeadlineStatus,
  setPaymentPlan,
  updateEvent,
} from "@/modules/deadlines/commands/deadlines";
import {
  addFederalHolidays,
  addHoliday,
  removeHoliday,
  revokeRuleVerification,
  setRuleActive,
  syncDeadlineRules,
  updateDeadlineRule,
  verifyDeadlineRule,
} from "@/modules/deadlines/commands/rules";
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
  // Phase 1: GHL sync and intake
  ingestGhlWebhook,
  processGhlWebhook,
  markGhlWebhookFailed,
  retryGhlWebhook,
  reconcileGhlBatch,
  recordSyncRun,
  requestReconcile,
  claimMessage,
  recordSendResult,
  markStaleSend,
  saveMessageTemplate,
  approveMessageTemplate,
  withdrawTemplateApproval,
  // Phase 2: AI intake
  recordAiRun,
  decideApproval,
  updateAiSettings,
  updateIntakeProfile,
  a3Handoff,
  a3Turn,
  a3Skipped,
  rerunConflictCheck,
  reviewConflictCheck,
  addConflictParties,
  removeConflictParty,
  a8Brief,
  a10Enroll,
  declineLead,
  a11Cold,
  referLead,
  saveReferralPartner,
  removeReferralPartner,
  // Phase 3: matters and documents
  openMatter,
  changeStage,
  assignMatter,
  addParty,
  removeParty,
  addNote,
  createTask,
  setTaskStatus,
  reissuePortalLink,
  recordUpload,
  applyProcessing,
  confirmExtraction,
  setDocumentType,
  shareDocument,
  logDownload,
  applySummary,
  draftEngagement,
  markEngagementSigned,
  withdrawEngagement,
  sendEngagementReminders,
  closeMatter,
  draftStatusUpdate,
  applyDraft,
  saveQuestionnaire,
  chaseDocuments,
  flagStalled,
  updateEngagementTemplate,
  // Phase 4: deadlines
  syncDeadlineRules,
  updateDeadlineRule,
  verifyDeadlineRule,
  revokeRuleVerification,
  setRuleActive,
  addHoliday,
  addFederalHolidays,
  removeHoliday,
  recordEvent,
  updateEvent,
  removeEvent,
  addDeadline,
  moveDeadline,
  setDeadlineStatus,
  assignDeadline,
  acknowledgeAlerts,
  addTolling,
  removeTolling,
  setPaymentPlan,
  endPaymentPlan,
  runDeadlinesDaily,
  escalateDeadlineAlerts,
  runDeadlineAudit,
  createCalendarFeed,
  revokeCalendarFeed,
] as const satisfies readonly AnyCommand[];
