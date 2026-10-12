/**
 * Demo firm seed (spec Section 11, Phase 0): Siekierski Law PLLC, McKinney TX.
 *
 * Rule 12: synthetic data only. The firm name belongs to the design partner;
 * every other person, address, phone number and email is fictional (555-01xx
 * numbers, the reserved .test domain). Refuses to run unless DEMO_MODE=true.
 *
 * Every write goes through the same commands and Better Auth endpoints the
 * app uses, so the demo's audit log is real, not fabricated.
 *
 *   DEMO_MODE=true pnpm db:seed:demo [--reset]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { symmetricEncrypt } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { generateSync } from "otplib";
import { closeDb, getDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { twoFactors, users } from "@/db/schema";
import { getAuth } from "@/lib/auth/auth";
import type { AnyCommand, Command, Principal, SessionUser } from "@/lib/commands/define";
import { execute } from "@/lib/commands/execute";
import { env } from "@/lib/env";
import { updateFirmSettings } from "@/modules/firm/commands/update-settings";
import { DEFAULT_AI_DISCLOSURE } from "@/modules/firm/schemas";
import { acceptInvite } from "@/modules/users/commands/accept-invite";
import { inviteUser } from "@/modules/users/commands/invite";
import { runBootstrap } from "@/scripts/lib/firm-bootstrap";
import { seedDemoAi } from "./demo-ai";
import { seedDemoDeadlines } from "./demo-deadlines";
import { DEMO_CLIENT_EMAIL, seedDemoMatters } from "./demo-matters";
import { seedDemoIntake } from "./demo-intake";
import type { z } from "zod";

const DEMO_PASSWORD = "Demo password for LexDesk 2026";
/**
 * Fixed authenticator secret shared by the demo accounts so a presenter adds it
 * to an authenticator app once. Demo databases only; never used by provisioning.
 */
const DEMO_TOTP_RAW_SECRET = "lexdesk-demo-authenticator-key01";
const DOMAIN = "demo.lexdesk.test";
const ORIGIN = () => env().APP_URL;

const STAFF = [
  {
    name: "Maria Delgado",
    email: `maria.delgado@${DOMAIN}`,
    role: "paralegal",
    title: "Senior Paralegal",
    enroll: true,
  },
  {
    name: "Jordan Pike",
    email: `jordan.pike@${DOMAIN}`,
    role: "intake",
    title: "Intake Coordinator",
    enroll: true,
  },
  {
    name: "Priya Raman",
    email: `priya.raman@${DOMAIN}`,
    role: "billing",
    title: "Billing Manager",
    enroll: true,
  },
  // Left at the invitation stage so the Users screen shows a pending invite.
  {
    name: "Evan Brooks",
    email: `evan.brooks@${DOMAIN}`,
    role: "attorney",
    title: "Associate Attorney",
    enroll: false,
  },
] as const;

const REQUEST = { ip: "127.0.0.1", userAgent: "lexdesk-demo-seed", requestId: "script:demo-seed" };

function base32(input: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of Buffer.from(input, "utf8")) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

const DEMO_TOTP_BASE32 = base32(DEMO_TOTP_RAW_SECRET);

function run(command: AnyCommand, principal: Principal, input: unknown) {
  return execute(command as unknown as Command<z.ZodType, unknown>, principal, input, {
    request: REQUEST,
  });
}

/** Minimal cookie-carrying client for Better Auth's handler. */
class AuthSession {
  private cookies = new Map<string, string>();
  async post(
    pathname: string,
    body: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const headers = new Headers({
      origin: ORIGIN(),
      "content-type": "application/json",
      "x-forwarded-for": REQUEST.ip,
      "user-agent": REQUEST.userAgent,
    });
    if (this.cookies.size)
      headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await getAuth().handler(
      new Request(new URL(`/api/auth${pathname}`, ORIGIN()), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const idx = pair!.indexOf("=");
      this.cookies.set(pair!.slice(0, idx).trim(), pair!.slice(idx + 1));
    }
    const text = await res.text();
    return {
      status: res.status,
      json: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    };
  }
}

/** Real enrollment through Better Auth, then the TOTP secret is swapped for the shared demo secret. */
async function enrollDemoMfa(email: string): Promise<void> {
  const s = new AuthSession();
  const signIn = await s.post("/sign-in/email", { email, password: DEMO_PASSWORD });
  if (signIn.status !== 200) throw new Error(`demo sign-in failed for ${email}: ${signIn.status}`);
  const enable = await s.post("/two-factor/enable", { password: DEMO_PASSWORD });
  if (enable.status !== 200) throw new Error(`enable 2FA failed for ${email}`);

  const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email));
  const encrypted = await symmetricEncrypt({ key: env().AUTH_SECRET, data: DEMO_TOTP_RAW_SECRET });
  await getDb().update(twoFactors).set({ secret: encrypted }).where(eq(twoFactors.userId, u!.id));

  const verify = await s.post("/two-factor/verify-totp", {
    code: generateSync({ secret: DEMO_TOTP_BASE32 }),
  });
  if (verify.status !== 200)
    throw new Error(
      `demo TOTP verification failed for ${email}; Better Auth's secret format may have changed`,
    );
  await s.post("/sign-out", {});
}

/** Proves the finished demo works end to end: password + TOTP sign-in. */
async function smokeTest(email: string): Promise<void> {
  const s = new AuthSession();
  const first = await s.post("/sign-in/email", { email, password: DEMO_PASSWORD });
  if (first.json?.twoFactorRedirect !== true)
    throw new Error("smoke test: expected an MFA challenge");
  const second = await s.post("/two-factor/verify-totp", {
    code: generateSync({ secret: DEMO_TOTP_BASE32 }),
  });
  if (second.status !== 200) throw new Error("smoke test: TOTP sign-in failed");
  await s.post("/sign-out", {});
}

async function resetDatabase(): Promise<void> {
  // Demo only: wipe everything, including the append-only audit log.
  await getDb().execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await getDb().execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await getDb().execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
  await getDb().execute(sql`CREATE SCHEMA public`);
}

async function main(): Promise<void> {
  const e = env();
  if (!e.DEMO_MODE) throw new Error("Refusing to seed: DEMO_MODE must be true.");
  if (e.FIRM_SLUG !== "siekierski-law") {
    throw new Error(`Demo seed expects FIRM_SLUG=siekierski-law (got ${e.FIRM_SLUG}).`);
  }

  if (process.argv.includes("--reset")) {
    console.log("Resetting demo database…");
    await resetDatabase();
    await closeDb();
  }
  await runMigrations(e.DATABASE_URL);

  console.log("Provisioning Siekierski Law PLLC (demo)…");
  const boot = await runBootstrap(
    getDb(),
    {
      slug: e.FIRM_SLUG,
      legalName: "Siekierski Law PLLC",
      displayName: "Siekierski Law",
      practiceAreas: ["tax", "business", "estate"],
      city: "McKinney",
      state: "TX",
      owner: { name: "Scott Siekierski", email: `scott@${DOMAIN}`, title: "Managing Attorney" },
    },
    "demo-seed",
  );

  const ownerToken = new URL(boot.setupUrl).pathname.split("/").pop()!;
  await run(
    acceptInvite,
    { type: "anonymous" },
    { token: ownerToken, password: DEMO_PASSWORD, confirmPassword: DEMO_PASSWORD },
  );
  await enrollDemoMfa(`scott@${DOMAIN}`);

  const owner: SessionUser = {
    id: boot.ownerId,
    email: `scott@${DOMAIN}`,
    name: "Scott Siekierski",
    role: "owner_attorney",
    status: "active",
  };
  const asOwner: Principal = { type: "user", user: owner };

  await run(updateFirmSettings, asOwner, {
    legalName: "Siekierski Law PLLC",
    displayName: "Siekierski Law",
    addressLine1: "100 Example Plaza",
    addressLine2: "Suite 200",
    city: "McKinney",
    state: "TX",
    postalCode: "75069",
    phone: "(214) 555-0142",
    website: "https://siekierski-law.example.test",
    bookingUrl: "https://book.example.test/siekierski-law/consult",
    intakeFormUrl: "https://forms.example.test/siekierski-law/intake",
    practiceAreas: ["tax", "business", "estate"],
    aiDisclosureText: DEFAULT_AI_DISCLOSURE,
    attorneysSeeFinancials: false,
    ipAllowlist: [],
  });

  const pending: { name: string; url: string }[] = [];
  for (const person of STAFF) {
    const r = (await run(inviteUser, asOwner, {
      name: person.name,
      email: person.email,
      role: person.role,
      title: person.title,
    })) as {
      setupUrl: string;
    };
    if (person.enroll) {
      const token = new URL(r.setupUrl).pathname.split("/").pop()!;
      await run(
        acceptInvite,
        { type: "anonymous" },
        { token, password: DEMO_PASSWORD, confirmPassword: DEMO_PASSWORD },
      );
      await enrollDemoMfa(person.email);
    } else {
      pending.push({ name: person.name, url: r.setupUrl });
    }
  }

  console.log("Seeding intake activity…");
  const intake = await seedDemoIntake(asOwner);
  console.log(`  ${intake.leads} synthetic enquiries processed through the webhook pipeline.`);

  console.log("Seeding AI intake…");
  const ai = await seedDemoAi(asOwner);
  console.log(
    `  ${ai.conversations} text conversations run through the intake assistant (demo model).`,
  );

  console.log("Seeding matters and the client portal…");
  const seeded = await seedDemoMatters(asOwner);
  // The demo client sets a password and enrolls MFA like any portal user.
  const clientToken = new URL(seeded.clientSetupUrl).pathname.split("/").pop()!;
  await run(
    acceptInvite,
    { type: "anonymous" },
    { token: clientToken, password: DEMO_PASSWORD, confirmPassword: DEMO_PASSWORD },
  );
  await enrollDemoMfa(DEMO_CLIENT_EMAIL);
  console.log(`  ${seeded.matters} matters, with portal access for ${DEMO_CLIENT_EMAIL}.`);

  console.log("Seeding deadlines…");
  const dl = await seedDemoDeadlines(asOwner, seeded.ids);
  console.log(
    `  ${dl.deadlines} deadlines; ${dl.verified} rules marked verified for the demo only (citation says so).`,
  );

  await smokeTest(`scott@${DOMAIN}`);

  const otpauth = `otpauth://totp/LexDesk%20Demo?secret=${DEMO_TOTP_BASE32}&issuer=LexDesk%20Demo&digits=6&period=30`;
  const lines = [
    "# LexDesk demo credentials (synthetic data, demo databases only)",
    "",
    `App: ${e.APP_URL}`,
    `Password for every enrolled account: ${DEMO_PASSWORD}`,
    `Authenticator key (shared by all demo accounts): ${DEMO_TOTP_BASE32}`,
    `otpauth URI: ${otpauth}`,
    "",
    "| Name | Email | Role |",
    "|---|---|---|",
    `| Scott Siekierski | scott@${DOMAIN} | Owner attorney |`,
    ...STAFF.filter((p) => p.enroll).map((p) => `| ${p.name} | ${p.email} | ${p.role} |`),
    `| Jamie Rivera | ${DEMO_CLIENT_EMAIL} | Client (portal) |`,
    "",
    ...pending.map((p) => `Pending invite for ${p.name}: ${p.url}`),
    "",
  ];
  const dir = path.join(process.cwd(), ".demo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "credentials.md"), lines.join("\n"), { mode: 0o600 });

  console.log(lines.join("\n"));
  console.log("Demo seed complete. Credentials written to .demo/credentials.md (git-ignored).");
}

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
