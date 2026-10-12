import type { Metadata } from "next";
import { Notice } from "@/components/ui/notice";
import { PageHeader, Panel, PanelBody } from "@/components/ui/panel";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { hasFeature } from "@/lib/flags";
import { formatDateTime } from "@/lib/ui/format";
import { myCalendarFeed } from "@/modules/deadlines/queries";
import { DEADLINE_NOTICE } from "@/modules/deadlines/rules";
import { CalendarFeedControls } from "../../deadlines/deadline-controls";

export const metadata: Metadata = { title: "Calendar link" };

export default async function CalendarFeedPage() {
  const { user } = await requirePermission("deadlines.read");
  const [feed, on] = await Promise.all([myCalendarFeed(user), hasFeature("automation.C6")]);
  return (
    <>
      <PageHeader
        title="Calendar link"
        description="Your open deadlines in Google Calendar or Outlook (C6): deadlines you own and deadlines on matters you are responsible for."
      />
      <div className="max-w-2xl space-y-5">
        <Notice tone="warning">
          {DEADLINE_NOTICE} Calendar apps refresh subscribed calendars on their own schedule, often
          every few hours, so a changed date can take time to appear there. The matter page in
          LexDesk shows the current date.
        </Notice>
        {!on ? (
          <Notice tone="info">
            Calendar links are switched off for this firm (Settings &gt; Features, C6).
          </Notice>
        ) : (
          <Panel>
            <PanelBody className="space-y-3">
              <p className="text-[13px]">
                {feed
                  ? `Your link was created ${formatDateTime(feed.updatedAt, env().FIRM_TIMEZONE)}. For security it is not shown again; make a new link if you need it.`
                  : "You have no calendar link."}
              </p>
              <p className="text-[12.5px] text-muted">
                Events show the matter number and the deadline name, never the client&apos;s name.
              </p>
              <CalendarFeedControls
                hasFeed={feed !== null}
                base={env().APP_URL.replace(/\/$/, "")}
              />
            </PanelBody>
          </Panel>
        )}
      </div>
    </>
  );
}
