import { boolean, integer, pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { APPOINTMENT_STATUSES, LEAD_CHANNELS, LEAD_STATUSES } from "./intake";
import { PRACTICE_AREAS } from "./firm";

/*
 * Metric views (spec Section 9). Created by migration 0003; declared here with
 * `.existing()` so queries are typed and drizzle-kit leaves them alone.
 */

export const metricsLeadFacts = pgView("metrics_lead_facts", {
  leadId: uuid("lead_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  status: text("status", { enum: LEAD_STATUSES }).notNull(),
  channel: text("channel", { enum: LEAD_CHANNELS }).notNull(),
  practiceArea: text("practice_area", { enum: PRACTICE_AREAS }),
  missedCall: boolean("missed_call").notNull(),
  firstInboundAt: timestamp("first_inbound_at", { withTimezone: true }).notNull(),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  firstHumanResponseAt: timestamp("first_human_response_at", { withTimezone: true }),
  firstResponseSeconds: integer("first_response_seconds"),
  consultBookedAt: timestamp("consult_booked_at", { withTimezone: true }),
  consultHeldAt: timestamp("consult_held_at", { withTimezone: true }),
  retainedAt: timestamp("retained_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  firstTouchSource: text("first_touch_source").notNull(),
  lastTouchSource: text("last_touch_source").notNull(),
  recovered: boolean("recovered").notNull(),
}).existing();

export const metricsConsults = pgView("metrics_consults", {
  appointmentId: uuid("appointment_id").notNull(),
  leadId: uuid("lead_id").notNull(),
  status: text("status", { enum: APPOINTMENT_STATUSES }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  showed: boolean("showed").notNull(),
  noShow: boolean("no_show").notNull(),
}).existing();
