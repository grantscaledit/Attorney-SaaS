import type { Metadata, Route } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { PracticeArea } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { formatPercent } from "@/lib/ui/format";
import { PRACTICE_AREA_LABELS } from "@/modules/intake/labels";
import { pipeline } from "@/modules/matters/queries";
import { stageLabel } from "@/modules/matters/scope";
import { PIPELINE_METRICS as P } from "@/modules/metrics/definitions";
import { matterType } from "@/practice";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const { user } = await requirePermission("matters.read");
  const d = await pipeline(user);
  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Open matters right now. Hover a figure for its definition; select it to see the matters behind it."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Link href={"/matters" as Route}>
          <Stat label={P.open.label} definition={P.open.definition} value={d.open} />
        </Link>
        <Link href={"/matters?view=stalled" as Route}>
          <Stat label={P.stalled.label} definition={P.stalled.definition} value={d.stalled} />
        </Link>
        <Link href={"/matters?view=waiting_on_client" as Route}>
          <Stat
            label={P.waitingOnClient.label}
            definition={P.waitingOnClient.definition}
            value={d.waitingOnClient}
          />
        </Link>
        <Stat
          label={P.unsignedEngagements.label}
          definition={P.unsignedEngagements.definition}
          value={d.unsignedEngagements}
        />
        <Stat
          label={P.checklistCompletion.label}
          definition={P.checklistCompletion.definition}
          value={d.checklist.rate === null ? "–" : formatPercent(d.checklist.rate)}
          context={`${d.checklist.received} of ${d.checklist.required} required documents`}
        />
      </div>
      <Panel className="mt-6">
        <PanelHeader
          title="Open matters by type and stage"
          description="Days in stage against the stage's threshold."
        />
        {d.byStage.length === 0 ? (
          <EmptyState title="No open matters" />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Practice area</Th>
                <Th>Type</Th>
                <Th>Stage</Th>
                <Th className="text-right">Matters</Th>
                <Th className="text-right">Average days in stage</Th>
                <Th className="text-right">Past threshold</Th>
              </tr>
            </THead>
            <TBody>
              {d.byStage
                .sort(
                  (a, b) =>
                    a.practiceArea.localeCompare(b.practiceArea) ||
                    a.matterType.localeCompare(b.matterType),
                )
                .map((g) => {
                  const area = g.practiceArea as PracticeArea;
                  return (
                    <Tr key={`${g.practiceArea}|${g.matterType}|${g.stage}`}>
                      <Td>{PRACTICE_AREA_LABELS[area]}</Td>
                      <Td>{matterType(area, g.matterType)?.label ?? g.matterType}</Td>
                      <Td>
                        <Link
                          href={`/matters?practiceArea=${area}&stage=${g.stage}` as Route}
                          className="text-accent hover:underline"
                        >
                          {stageLabel({
                            practiceArea: area,
                            matterType: g.matterType,
                            stage: g.stage,
                          })}
                        </Link>
                      </Td>
                      <Td className="text-right tabular-nums">{g.matters}</Td>
                      <Td className="text-right tabular-nums">{g.avgDaysInStage}</Td>
                      <Td className="text-right tabular-nums">{g.stalled}</Td>
                    </Tr>
                  );
                })}
            </TBody>
          </Table>
        )}
      </Panel>
    </>
  );
}
