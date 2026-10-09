import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, CircleSlash, Info, XCircle } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]",
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-ink-2",
        accent: "bg-accent-soft text-accent",
        good: "bg-good-soft text-good",
        warning: "bg-warning-soft text-warning",
        critical: "bg-critical-soft text-critical",
        info: "bg-info-soft text-info",
        outline: "border border-line-strong text-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const STATUS_ICON = {
  good: CheckCircle2,
  warning: AlertTriangle,
  critical: XCircle,
  info: Info,
  neutral: CircleSlash,
} as const;

/** Status is never color alone: icon + label, always (dataviz rule). */
export function StatusLabel({
  tone,
  children,
}: {
  tone: keyof typeof STATUS_ICON;
  children: ReactNode;
}) {
  const Icon = STATUS_ICON[tone];
  const color = {
    good: "text-good",
    warning: "text-warning",
    critical: "text-critical",
    info: "text-info",
    neutral: "text-muted",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px]", color)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </span>
  );
}
