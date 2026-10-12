import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("rounded-lg border border-line bg-surface shadow-panel", className)}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex items-start justify-between gap-4 border-b border-line px-5 py-3.5",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="eyebrow">{title}</h2>
        {description ? <p className="mt-1 text-[13px] text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-2">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Definition list row used in summary panels. */
export function DataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-line py-2.5 last:border-b-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="text-right text-[13px] text-ink">{children}</dd>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children ? (
        <div className="mx-auto mt-1 max-w-md text-[13px] text-muted">{children}</div>
      ) : null}
    </div>
  );
}
