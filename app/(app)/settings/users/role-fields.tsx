"use client";

import { Field, Input, Select, fieldControlProps } from "@/components/ui/field";

export type RoleOption = { value: string; label: string; summary: string };

export function PersonFields({
  errors,
  roles,
  defaults,
  includeEmail,
  lockRole,
}: {
  errors?: Record<string, string[]>;
  roles: RoleOption[];
  defaults?: { name?: string; email?: string; role?: string; title?: string | null };
  includeEmail?: boolean;
  lockRole?: string;
}) {
  return (
    <div className="space-y-4">
      <Field id="name" label="Full name" errors={errors?.name}>
        <Input
          {...fieldControlProps("name", errors?.name)}
          defaultValue={defaults?.name}
          autoComplete="off"
          required
          autoFocus
        />
      </Field>
      {includeEmail ? (
        <Field
          id="email"
          label="Work email"
          errors={errors?.email}
          hint="They sign in with this address."
        >
          <Input
            {...fieldControlProps("email", errors?.email, true)}
            type="email"
            defaultValue={defaults?.email}
            autoComplete="off"
            required
          />
        </Field>
      ) : null}
      <Field id="title" label="Job title" optional errors={errors?.title}>
        <Input
          {...fieldControlProps("title", errors?.title)}
          defaultValue={defaults?.title ?? ""}
          placeholder="e.g. Senior Paralegal"
        />
      </Field>
      <Field id="role" label="Role" errors={errors?.role} hint={lockRole}>
        <Select
          {...fieldControlProps("role", errors?.role, Boolean(lockRole))}
          defaultValue={defaults?.role ?? "paralegal"}
          disabled={Boolean(lockRole)}
        >
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      {lockRole ? <input type="hidden" name="role" value={defaults?.role} /> : null}
    </div>
  );
}
