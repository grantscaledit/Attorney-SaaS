import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/panel";
import { can } from "@/lib/auth/can";
import { requirePermission } from "@/lib/auth/session";
import { loadFirmSettings } from "@/lib/firm.config";
import { getRequestMeta } from "@/lib/request-context";
import { FirmSettingsForm } from "./firm-settings-form";

export const metadata: Metadata = { title: "Firm settings" };

export default async function FirmSettingsPage() {
  const { user, policy } = await requirePermission("firm.settings.read");
  const [settings, meta] = await Promise.all([loadFirmSettings(), getRequestMeta()]);
  const editable = can(user, "firm.settings.update", { policy });

  return (
    <>
      <PageHeader
        title="Firm settings"
        description={
          editable
            ? "The firm's profile, the AI disclosure shown to prospects and clients, and access rules. Every change is recorded in the audit log."
            : "The firm's profile and access rules. Only an owner attorney can change these."
        }
      />
      <FirmSettingsForm
        editable={editable}
        currentIp={meta.ip}
        initial={{
          legalName: settings.legalName,
          displayName: settings.displayName,
          addressLine1: settings.addressLine1 ?? "",
          addressLine2: settings.addressLine2 ?? "",
          city: settings.city ?? "",
          state: settings.state ?? "",
          postalCode: settings.postalCode ?? "",
          phone: settings.phone ?? "",
          website: settings.website ?? "",
          bookingUrl: settings.bookingUrl ?? "",
          intakeFormUrl: settings.intakeFormUrl ?? "",
          practiceAreas: settings.practiceAreas,
          aiDisclosureText: settings.aiDisclosureText,
          attorneysSeeFinancials: settings.attorneysSeeFinancials,
          ipAllowlist: settings.ipAllowlist.join("\n"),
        }}
      />
    </>
  );
}
