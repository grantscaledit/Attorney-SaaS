import type { Metadata } from "next";
import { EmptyState, PageHeader, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { can } from "@/lib/auth/can";
import { requirePermission } from "@/lib/auth/session";
import { listConflictParties } from "@/modules/intake/ai-queries";
import { AddConflictParties, RemoveConflictParty } from "./conflict-forms";

export const metadata: Metadata = { title: "Conflict list" };

const ROLES = { client: "Client", adverse: "Adverse party", related: "Related party" } as const;

export default async function ConflictListPage() {
  const { user } = await requirePermission("conflicts.read");
  const parties = await listConflictParties(user);
  const canEdit = can(user, "firm.settings.update");
  return (
    <>
      <PageHeader
        title="Conflict list"
        description="People and businesses every new enquiry is checked against (A6), alongside existing contacts. Add current and former clients, adverse parties and related parties until matters are tracked in LexDesk."
      />
      <div className="space-y-6">
        {canEdit ? (
          <Panel>
            <PanelHeader title="Add names" />
            <PanelBody>
              <AddConflictParties />
            </PanelBody>
          </Panel>
        ) : null}
        <Panel>
          <PanelHeader title={`On the list (${parties.length})`} />
          {parties.length === 0 ? (
            <EmptyState title="No names yet" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Matter</Th>
                  {canEdit ? <Th className="text-right">{""}</Th> : null}
                </tr>
              </THead>
              <TBody>
                {parties.map((p) => (
                  <Tr key={p.id}>
                    <Td>{p.name}</Td>
                    <Td>{ROLES[p.role]}</Td>
                    <Td>{p.matterReference ?? "–"}</Td>
                    {canEdit ? (
                      <Td className="text-right">
                        <RemoveConflictParty partyId={p.id} name={p.name} />
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
