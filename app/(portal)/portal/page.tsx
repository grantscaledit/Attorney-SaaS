import type { Metadata, Route } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Panel } from "@/components/ui/panel";
import { requireClient } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/ui/format";
import { portalMatters } from "@/modules/matters/queries";

export const metadata: Metadata = { title: "Your matters" };

export default async function PortalHome() {
  const { user } = await requireClient();
  const rows = await portalMatters(user);
  return (
    <>
      <PageHeader
        title="Your matters"
        description="Upload documents, see what the firm still needs, and follow where your matter stands."
      />
      <Panel>
        {rows.length === 0 ? (
          <EmptyState title="No matters yet" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((m) => (
              <li key={m.id} className="px-5 py-3.5">
                <Link
                  href={`/portal/matters/${m.id}` as Route}
                  className="text-[14px] font-medium text-accent hover:underline"
                >
                  {m.title}
                </Link>
                <p className="text-[12.5px] text-muted">
                  Matter {m.number} · {m.status === "closed" ? "Closed" : m.stageLabel} · opened{" "}
                  {formatDate(m.openedAt, env().FIRM_TIMEZONE)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
