"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { setFeatureAction } from "./actions";

export type FeatureView = {
  flag: string;
  label: string;
  inTier: boolean;
  enabled: boolean;
  /** The capability has shipped. Unshipped ones can be pre-configured but do nothing yet. */
  available: boolean;
};

export function FeatureList({
  groups,
  editable,
  tierLabel,
}: {
  groups: { group: string; label: string; items: FeatureView[] }[];
  editable: boolean;
  tierLabel: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.flag, i.enabled]))) as Record<
      string,
      boolean
    >,
    (state, change: { flag: string; enabled: boolean }) => ({
      ...state,
      [change.flag]: change.enabled,
    }),
  );

  const toggle = (flag: string, enabled: boolean) =>
    start(async () => {
      setError(null);
      setOptimistic({ flag, enabled });
      const result = await setFeatureAction(flag, enabled);
      if (result.status === "error") setError(result.message);
    });

  return (
    <div className="space-y-6">
      {error ? <Notice tone="critical">{error}</Notice> : null}
      {groups.map((g) => (
        <Panel key={g.group}>
          <PanelHeader title={g.label} />
          <ul className="divide-y divide-line">
            {g.items.map((item) => {
              const [id, ...rest] = item.label.split(" ");
              const hasId = /^[A-G]\d+$/.test(id ?? "");
              return (
                <li key={item.flag} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="flex min-w-0 items-baseline gap-3">
                    {hasId ? (
                      <span className="w-8 shrink-0 font-mono text-[12px] text-muted">{id}</span>
                    ) : null}
                    <span className={item.inTier ? "text-ink" : "text-muted"}>
                      {hasId ? rest.join(" ") : item.label}
                    </span>
                    {!item.inTier ? (
                      <Badge tone="outline">Firm plan</Badge>
                    ) : !item.available ? (
                      <Badge tone="neutral">Coming</Badge>
                    ) : null}
                  </div>
                  <Switch
                    checked={item.inTier && optimistic[item.flag] === true}
                    disabled={!editable || !item.inTier}
                    onCheckedChange={(v) => toggle(item.flag, v)}
                    aria-label={`${item.label}: ${optimistic[item.flag] ? "on" : "off"}`}
                  />
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}
      <p className="text-[12.5px] text-muted">
        Features marked &ldquo;Firm plan&rdquo; are not included in the {tierLabel} plan. Features
        marked &ldquo;Coming&rdquo; can be switched now and take effect when they are delivered.
      </p>
    </div>
  );
}
