import type { Metadata } from "next";
import { EmptyState, PageHeader, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { can } from "@/lib/auth/can";
import { requirePermission } from "@/lib/auth/session";
import { listReferralPartners } from "@/modules/intake/ai-queries";
import { AddReferralPartner, RemoveReferralPartner } from "./referral-forms";

export const metadata: Metadata = { title: "Referral partners" };

export default async function ReferralPartnersPage() {
  const { user } = await requirePermission("firm.settings.read");
  const partners = await listReferralPartners(user);
  const canEdit = can(user, "firm.settings.update");
  return (
    <>
      <PageHeader
        title="Referral partners"
        description="Where the firm sends enquiries outside its practice areas (A12). Each referral is drafted for approval before it is sent, and tracked here."
      />
      <div className="space-y-6">
        {canEdit ? (
          <Panel>
            <PanelHeader title="Add a partner" />
            <PanelBody>
              <AddReferralPartner />
            </PanelBody>
          </Panel>
        ) : null}
        <Panel>
          <PanelHeader title="Partners" />
          {partners.length === 0 ? (
            <EmptyState title="No referral partners yet" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Partner</Th>
                  <Th>Takes</Th>
                  <Th>Contact</Th>
                  <Th className="text-right">Referrals</Th>
                  {canEdit ? <Th className="text-right">{""}</Th> : null}
                </tr>
              </THead>
              <TBody>
                {partners.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      {p.name}
                      {p.organization ? (
                        <span className="block text-[12px] text-muted">{p.organization}</span>
                      ) : null}
                    </Td>
                    <Td>{p.handles.join(", ")}</Td>
                    <Td className="text-[12.5px]">
                      {[p.phone, p.email, p.website].filter(Boolean).join(" · ") || "–"}
                    </Td>
                    <Td className="text-right tabular-nums">{p.referrals}</Td>
                    {canEdit ? (
                      <Td className="text-right">
                        <RemoveReferralPartner id={p.id} name={p.name} />
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
