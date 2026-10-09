/**
 * TEST_DATABASE_ADMIN_URL must point at a Postgres server where the user can
 * CREATE and DROP databases. Only databases named lexdesk_it_* are touched.
 */
export const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
export const TEMPLATE_DB = "lexdesk_it_template";

export function dbUrl(name: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}
