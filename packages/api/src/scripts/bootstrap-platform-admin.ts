import "dotenv/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { EmailSchema } from "@omnitwin/types";
import { createDb, type Database } from "../db/client.js";
import { users } from "../db/schema.js";

const BOOTSTRAP_SECRET_ENV = "VENVIEWER_PLATFORM_ADMIN_BOOTSTRAP_SECRET";
const MIN_BOOTSTRAP_SECRET_LENGTH = 32;

export interface BootstrapPlatformAdminArgs {
  readonly email: string;
  readonly name: string | null;
  readonly secret: string;
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

function readFlagValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseBootstrapPlatformAdminArgs(argv: readonly string[]): BootstrapPlatformAdminArgs {
  const allowedFlags = new Set(["--email", "--name", "--secret"]);
  for (const arg of argv) {
    if (arg.startsWith("--") && !allowedFlags.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const rawEmail = readFlagValue(argv, "--email");
  const secret = readFlagValue(argv, "--secret");
  const rawName = readFlagValue(argv, "--name");
  if (rawEmail === null) throw new Error("--email is required");
  if (secret === null) throw new Error("--secret is required");

  const emailResult = EmailSchema.safeParse(rawEmail);
  if (!emailResult.success) throw new Error("--email must be a valid email address");

  const name = rawName === null ? null : rawName.trim();
  if (name !== null && (name.length === 0 || name.length > 200)) {
    throw new Error("--name must be 1-200 characters when provided");
  }

  return {
    email: emailResult.data.toLowerCase(),
    name,
    secret,
  };
}

export function assertBootstrapSecret(
  suppliedSecret: string,
  env: { readonly VENVIEWER_PLATFORM_ADMIN_BOOTSTRAP_SECRET?: string },
): void {
  const expectedSecret = env[BOOTSTRAP_SECRET_ENV];
  if (expectedSecret === undefined || expectedSecret.length < MIN_BOOTSTRAP_SECRET_LENGTH) {
    throw new Error(`${BOOTSTRAP_SECRET_ENV} must be set to at least ${String(MIN_BOOTSTRAP_SECRET_LENGTH)} characters`);
  }
  if (suppliedSecret !== expectedSecret) {
    throw new Error("Bootstrap secret did not match");
  }
}

export async function bootstrapPlatformAdmin(
  db: Database,
  args: BootstrapPlatformAdminArgs,
): Promise<BootstrapPlatformAdminResult> {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, args.email))
    .limit(1);

  const now = new Date();
  if (existing !== undefined) {
    const [updated] = await db
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

  const [created] = await db
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
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined) return false;
  return resolve(entrypoint) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  const args = parseBootstrapPlatformAdminArgs(process.argv.slice(2));
  assertBootstrapSecret(args.secret, process.env);
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL is required");
  }

  const db = createDb(databaseUrl);
  const result = await bootstrapPlatformAdmin(db, args);
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
