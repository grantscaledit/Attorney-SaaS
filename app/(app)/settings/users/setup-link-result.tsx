"use client";

import { CopyField } from "@/components/ui/copy-field";
import { Notice } from "@/components/ui/notice";

/** Shown once after an invite or link reissue. The link is never stored in readable form. */
export function SetupLinkResult({
  url,
  expiresAt,
  name,
}: {
  url: string;
  expiresAt: Date;
  name: string;
}) {
  return (
    <div className="space-y-3">
      <Notice tone="good" title={`Setup link for ${name}`}>
        Send this link to them directly (email or text). It works once and expires{" "}
        {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(expiresAt),
        )}
        .
      </Notice>
      <CopyField value={url} label="Setup link" />
      <p className="text-[12.5px] text-muted">
        This is the only time the link is shown. If it is lost, issue a new one; the old link stops
        working.
      </p>
    </div>
  );
}
