import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

const TONES = {
  info: { icon: Info, cls: "border-info/30 bg-info-soft text-info" },
  good: { icon: CheckCircle2, cls: "border-good/30 bg-good-soft text-good" },
  warning: { icon: AlertTriangle, cls: "border-warning/30 bg-warning-soft text-warning" },
  critical: { icon: XCircle, cls: "border-critical/30 bg-critical-soft text-critical" },
} as const;

/** Inline message. Body text stays in ink; the tone colors only the icon, border and title. */
export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { icon: Icon, cls } = TONES[tone];
  return (
    <div
      role={tone === "critical" ? "alert" : "status"}
      className={cn("flex gap-2.5 rounded-md border px-3.5 py-2.5", cls, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 text-[13px]">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-ink-2">{children}</div> : null}
      </div>
    </div>
  );
}
