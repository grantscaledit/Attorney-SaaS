"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

/** Upload for one checklist item, or a general upload when no item is given. */
export function PortalUpload({
  matterId,
  checklistItemId,
  label,
}: {
  matterId: string;
  checklistItemId?: string;
  label: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "critical"; text: string } | null>(null);
  async function upload() {
    const file = ref.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const body = new FormData();
    body.set("file", file);
    if (checklistItemId) body.set("checklistItemId", checklistItemId);
    const res = await fetch(`/api/matters/${matterId}/documents`, { method: "POST", body });
    const json = (await res.json().catch(() => ({}))) as { error?: string; duplicate?: boolean };
    setBusy(false);
    if (!res.ok)
      setMsg({ tone: "critical", text: json.error ?? "The upload failed. Please try again." });
    else {
      setMsg({
        tone: "good",
        text: json.duplicate ? "We already have this file." : "Received. Thank you.",
      });
      if (ref.current) ref.current.value = "";
      router.refresh();
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={ref}
          type="file"
          aria-label={label}
          accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
          className="text-[13px]"
        />
        <Button size="sm" disabled={busy} onClick={upload}>
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </div>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </div>
  );
}
