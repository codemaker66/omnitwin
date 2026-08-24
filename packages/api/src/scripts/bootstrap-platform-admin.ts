import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { EmailSchema } from "@omnitwin/types";
import { createDb, type Database } from "../db/client.js";
import { users } from "../db/schema.js";
import {
  GRAND_HALL_STAGING_DATABASE_NAME,
  GRAND_HALL_STAGING_DATABASE_ROLE,
  GRAND_HALL_STAGING_TARGET_ID,
} from "../lib/grand-hall-frontier-contract.js";
import { assertGrandHallReviewedCheckout } from "./grand-hall-reviewed-checkout.js";

export const PLATFORM_ADMIN_BOOTSTRAP_STAGING_TARGET_ID =
  GRAND_HALL_STAGING_TARGET_ID;
export const PLATFORM_ADMIN_BOOTSTRAP_TARGET_ID_ENV =
  "VENVIEWER_PLATFORM_ADMIN_BOOTSTRAP_TARGET_ID";
export const PLATFORM_ADMIN_BOOTSTRAP_EXPECTED_DATABASE_HOST_ENV =
  "VENVIEWER_PLATFORM_ADMIN_BOOTSTRAP_EXPECTED_DATABASE_HOST";

export const PLATFORM_ADMIN_BOOTSTRAP_FRESHNESS_LOCK_SQL = `
do $venviewer_database_boundary$
begin
  if current_database() <> '${GRAND_HALL_STAGING_DATABASE_NAME}'
    or current_user <> '${GRAND_HALL_STAGING_DATABASE_ROLE}' then
    raise exception 'Grand Hall staging database identity mismatch';
  end if;
end
$venviewer_database_boundary$;

select pg_advisory_xact_lock(
  hashtextextended('venviewer:grand-hall-staging:platform-admin-bootstrap', 0)
);
do $venviewer_bootstrap$
declare
  application_table record;
  contains_rows boolean;
begin
  for application_table in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
    order by tablename
  loop
    execute format(
      'lock table %I.%I in share row exclusive mode',
      application_table.schemaname,
      application_table.tablename
    );
  end loop;

  for application_table in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public' and tablename <> 'users'
    order by tablename
  loop
    execute format(
      'select exists (select 1 from %I.%I limit 1)',
      application_table.schemaname,
      application_table.tablename
    ) into contains_rows;
    if contains_rows then
      raise exception 'Grand Hall staging application database is not empty';
    end if;
  end loop;
end
$venviewer_bootstrap$;
`;

export interface BootstrapPlatformAdminArgs {
  readonly email: string;
  readonly name: string | null;
}

export interface BootstrapPlatformAdminResult {
  readonly mode: "created" | "updated";
  readonly userId: string;
  readonly email: string;
  readonly role: "admin";
  readonly platformRole: "admin";
  readonly clerkLinked: boolean;
}

function defaultNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local.trim().length > 0 ? local.trim() : "Venviewer platform admin";
}

export function parseBootstrapPlatformAdminArgs(argv: readonly string[]): BootstrapPlatformAdminArgs {
  const allowedFlags = new Set(["--email", "--name"]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) {
      throw new Error("Unexpected positional argument");
    }
    if (!allowedFlags.has(arg)) {
      throw new Error("Unknown argument");
    }
    if (values.has(arg)) {
      throw new Error(`${arg} may be supplied only once`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    values.set(arg, value);
    index += 1;
  }

  const rawEmail = values.get("--email");
  const rawName = values.get("--name") ?? null;
  if (rawEmail === undefined) throw new Error("--email is required");

  const emailResult = EmailSchema.safeParse(rawEmail);
  if (!emailResult.success) throw new Error("--email must be a valid email address");

  const name = rawName === null ? null : rawName.trim();
  if (name !== null && (name.length === 0 || name.length > 200)) {
    throw new Error("--name must be 1-200 characters when provided");
  }

  return {
    email: emailResult.data.toLowerCase(),
    name,
  };
}

export function resolveBootstrapStagingDatabaseUrl(
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (env[PLATFORM_ADMIN_BOOTSTRAP_TARGET_ID_ENV] !== PLATFORM_ADMIN_BOOTSTRAP_STAGING_TARGET_ID) {
    throw new Error(
      `${PLATFORM_ADMIN_BOOTSTRAP_TARGET_ID_ENV} must be exactly ${PLATFORM_ADMIN_BOOTSTRAP_STAGING_TARGET_ID}`,
    );
  }

  const expectedHost = env[PLATFORM_ADMIN_BOOTSTRAP_EXPECTED_DATABASE_HOST_ENV];
  if (
    expectedHost === undefined ||
    expectedHost.trim() !== expectedHost ||
    expectedHost !== expectedHost.toLowerCase() ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$/u.test(expectedHost) ||
    !expectedHost.endsWith(".neon.tech") ||
    expectedHost.includes("-pooler.")
  ) {
    throw new Error(
      `${PLATFORM_ADMIN_BOOTSTRAP_EXPECTED_DATABASE_HOST_ENV} must be the exact lowercase direct Neon staging host`,
    );
  }

  const databaseUrl = env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim() !== databaseUrl) {
    throw new Error("DATABASE_URL must be supplied explicitly in the process environment");
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  const sslModeValues = parsed.searchParams.getAll("sslmode");
  const channelBindingValues = parsed.searchParams.getAll("channel_binding");
  const queryKeys = new Set(Array.from(parsed.searchParams.keys()));
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hostname !== expectedHost ||
    (parsed.port !== "" && parsed.port !== "5432") ||
    parsed.username !== GRAND_HALL_STAGING_DATABASE_ROLE ||
    parsed.password.length === 0 ||
    parsed.pathname !== `/${GRAND_HALL_STAGING_DATABASE_NAME}` ||
    parsed.hash !== "" ||
    queryKeys.size > 2 ||
    Array.from(queryKeys).some((key) => key !== "sslmode" && key !== "channel_binding") ||
    sslModeValues.length !== 1 ||
    sslModeValues[0] !== "require" ||
    channelBindingValues.length > 1 ||
    (channelBindingValues.length === 1 && channelBindingValues[0] !== "require")
  ) {
    throw new Error(
      `DATABASE_URL must use the code-pinned role ${GRAND_HALL_STAGING_DATABASE_ROLE}, database ${GRAND_HALL_STAGING_DATABASE_NAME}, exact recorded direct Neon staging host, and strict TLS parameters`,
    );
  }
  return databaseUrl;
}

export function assertBootstrapDatabaseIsFresh(input: {
  readonly requestedEmail: string;
  readonly existingUserEmails: readonly string[];
}): void {
  if (
    input.existingUserEmails.length > 1 ||
    (input.existingUserEmails[0] !== undefined &&
      input.existingUserEmails[0].toLowerCase() !== input.requestedEmail)
  ) {
    throw new Error(
      "Platform-admin bootstrap requires the fresh, unseeded Grand Hall staging database",
    );
  }
}

export async function bootstrapPlatformAdmin(
  db: Database,
  args: BootstrapPlatformAdminArgs,
): Promise<BootstrapPlatformAdminResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(PLATFORM_ADMIN_BOOTSTRAP_FRESHNESS_LOCK_SQL));
    const existingUsers = await tx.select().from(users).limit(2);
    assertBootstrapDatabaseIsFresh({
      requestedEmail: args.email,
      existingUserEmails: existingUsers.map((user) => user.email),
    });
    const existing = existingUsers[0];

    const now = new Date();
    if (existing !== undefined) {
      const [updated] = await tx
        .update(users)
        .set({
          name: args.name ?? existing.name,
          role: "admin",
          platformRole: "admin",
          updatedAt: now,
        })
        .where(eq(users.id, existing.id))
        .returning();
      if (updated === undefined) {
        throw new Error("Failed to update platform admin user");
      }
      return {
        mode: "updated",
        userId: updated.id,
        email: updated.email,
        role: "admin",
        platformRole: "admin",
        clerkLinked: updated.clerkId !== null,
      };
    }

    const [created] = await tx
      .insert(users)
      .values({
        clerkId: null,
        email: args.email,
        name: args.name ?? defaultNameFromEmail(args.email),
        role: "admin",
        platformRole: "admin",
        venueId: null,
      })
      .returning();
    if (created === undefined) {
      throw new Error("Failed to create platform admin user");
    }

    return {
      mode: "created",
      userId: created.id,
      email: created.email,
      role: "admin",
      platformRole: "admin",
      clerkLinked: false,
    };
  });
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined) return false;
  return resolve(entrypoint) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  await assertGrandHallReviewedCheckout({
    env: process.env,
    scriptFilePath: fileURLToPath(import.meta.url),
  });
  const args = parseBootstrapPlatformAdminArgs(process.argv.slice(2));
  const databaseUrl = resolveBootstrapStagingDatabaseUrl(process.env);

  const db = createDb(databaseUrl);
  let result: BootstrapPlatformAdminResult;
  try {
    result = await bootstrapPlatformAdmin(db, args);
  } catch {
    throw new Error("Staging platform-admin database operation failed safely");
  }
  process.stdout.write([
    `Platform admin ${result.mode}: ${result.email}`,
    `userId=${result.userId}`,
    `role=${result.role}`,
    `platformRole=${result.platformRole}`,
    `clerkLinked=${String(result.clerkLinked)}`,
    "Next: sign in with this exact verified Clerk email address.",
  ].join("\n"));
  process.stdout.write("\n");
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Platform admin bootstrap failed: ${message}\n`);
    process.exitCode = 1;
  });
}
