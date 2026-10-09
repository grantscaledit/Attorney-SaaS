export type FieldChange = { field: string; before: unknown; after: unknown };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Top-level field changes between two audit snapshots, sorted by field name. */
export function diffSnapshots(before: unknown, after: unknown): FieldChange[] {
  const b = isPlainObject(before) ? before : {};
  const a = isPlainObject(after) ? after : {};
  const fields = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changes: FieldChange[] = [];
  for (const field of [...fields].sort()) {
    if (JSON.stringify(b[field]) !== JSON.stringify(a[field])) {
      changes.push({ field, before: b[field] ?? null, after: a[field] ?? null });
    }
  }
  return changes;
}
