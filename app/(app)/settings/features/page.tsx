import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/panel";
import { can } from "@/lib/auth/can";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { FEATURES, FEATURE_GROUP_LABELS, allFeatureStates, type FeatureGroup } from "@/lib/flags";
import { FeatureList, type FeatureView } from "./feature-list";

export const metadata: Metadata = { title: "Features" };

/** Phase in which each capability becomes usable. Shown to the firm as "Not yet available". */
const CURRENT_PHASE = 0;

export default async function FeaturesPage() {
  const { user, policy } = await requirePermission("flags.read");
  const tier = env().FIRM_TIER;
  const states = await allFeatureStates();
  const editable = can(user, "flags.update", { policy });

  const groups = new Map<FeatureGroup, FeatureView[]>();
  for (const s of states) {
    const def = FEATURES[s.flag];
    const list = groups.get(def.group) ?? [];
    list.push({
      flag: s.flag,
      label: def.label,
      inTier: s.inTier,
      enabled: s.enabled,
      available: def.phase <= CURRENT_PHASE,
    });
    groups.set(def.group, list);
  }

  return (
    <>
      <PageHeader
        title="Features"
        description={`Everything included in the ${tier === "firm" ? "Firm" : "Solo"} plan is on by default. Turn off anything the firm does not want running. Changes are recorded in the audit log.`}
      />
      <FeatureList
        editable={editable}
        tierLabel={tier === "firm" ? "Firm" : "Solo"}
        groups={[...groups.entries()].map(([group, items]) => ({
          group,
          label: FEATURE_GROUP_LABELS[group],
          items,
        }))}
      />
    </>
  );
}
