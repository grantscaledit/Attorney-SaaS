import * as LabelPrimitive from "@radix-ui/react-label";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/ui/cn";

const controlBase =
  "w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted transition-colors focus-visible:border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/25 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted aria-[invalid=true]:border-critical";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlBase, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(controlBase, "min-h-24 py-2 leading-relaxed", className)} {...props} />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        controlBase,
        "h-9 appearance-none bg-[length:16px] pr-8",
        "select-chevron",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: LabelPrimitive.LabelProps) {
  return (
    <LabelPrimitive.Root className={cn("text-[13px] font-medium text-ink", className)} {...props} />
  );
}

type FieldProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  errors?: string[] | undefined;
  optional?: boolean;
  className?: string;
  children: ReactNode;
};

/** Label + control + hint + error, wired with ids for screen readers. */
export function Field({ id, label, hint, errors, optional, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="ml-1.5 font-normal text-muted">Optional</span> : null}
      </Label>
      {children}
      {hint && !errors?.length ? (
        <p id={`${id}-hint`} className="text-[12.5px] text-muted">
          {hint}
        </p>
      ) : null}
      {errors?.length ? (
        <p id={`${id}-error`} className="text-[12.5px] text-critical" role="alert">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

/** Props to spread on a control inside <Field> so aria wiring matches. */
export function fieldControlProps(id: string, errors?: string[], hint?: boolean) {
  const describedBy = errors?.length ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return {
    id,
    name: id,
    "aria-invalid": errors?.length ? true : undefined,
    "aria-describedby": describedBy,
  };
}
