import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { users } from "../db/schema.js";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../drizzle/0043_platform_admin_scope.sql", import.meta.url)),
  "utf8",
);

const journalRaw = readFileSync(
  fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url)),
  "utf8",
);

const JournalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), tag: z.string() })),
});

describe("platform admin user schema", () => {
  it("stores Venviewer platform authority separately from venue user role", () => {
    const cols = getTableColumns(users);
    expect(cols.role.name).toBe("role");
    expect(cols.platformRole.name).toBe("platform_role");
    expect(cols.platformRole.getSQLType()).toBe("varchar(20)");
    expect(cols.platformRole.notNull).toBe(true);
  });
});

describe("migration 0043_platform_admin_scope", () => {
  it("adds platform_role and constrains the allowed platform authority values", () => {
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "platform_role"');
    expect(migrationSql).toContain('"platform_role" IN (\'none\', \'operator\', \'admin\')');
    expect(migrationSql).toContain('"users_platform_role_check"');
  });

  it("does not silently promote legacy venue admins to Venviewer platform admins", () => {
    expect(migrationSql).not.toContain('WHERE "role" = \'admin\'');
    expect(migrationSql).not.toContain("SET \"platform_role\" = 'admin'");
    expect(migrationSql).not.toContain("workspace_memberships");
  });

  it("is registered after the event plan lifecycle migration", () => {
    const parsed: unknown = JSON.parse(journalRaw);
    const journal = JournalSchema.parse(parsed);
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags.indexOf("0043_platform_admin_scope")).toBeGreaterThan(tags.indexOf("0042_event_plan_lifecycle"));
  });
});
