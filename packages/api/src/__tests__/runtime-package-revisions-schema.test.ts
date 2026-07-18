import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runtimePackages } from "../db/schema.js";

const MIGRATION_TAG = "0052_runtime_package_revisions";

const JournalSchema = z.object({
  entries: z.array(z.object({
    idx: z.number().int().nonnegative(),
    tag: z.string(),
  }).passthrough()),
}).passthrough();

describe("runtime-package revision migration", () => {
  it("keeps Drizzle columns and database uniqueness aligned", () => {
    const columns = getTableColumns(runtimePackages);
    const uniqueNames = getTableConfig(runtimePackages).uniqueConstraints.map((constraint) => constraint.name);

    expect(columns.revision.name).toBe("revision");
    expect(columns.identityKind.name).toBe("identity_kind");
    expect(columns.contentDigest.name).toBe("content_digest");
    expect(uniqueNames).toContain("runtime_packages_venue_room_revision_unique");
    expect(uniqueNames).toContain("runtime_packages_venue_room_digest_unique");
  });

  it("backfills surviving rows as honest legacy identities without manufactured content hashes", async () => {
    const sql = await readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");

    expect(sql).toContain("row_number() OVER");
    expect(sql).toContain('PARTITION BY "venue_slug", "room_slug"');
    expect(sql).toContain('ORDER BY "created_at", "updated_at", "id"');
    expect(sql).toContain('"identity_kind" = \'legacy\'');
    expect(sql).toContain('"content_digest" = NULL');
    expect(sql).not.toMatch(/UPDATE[\s\S]*SET[\s\S]*"content_digest"\s*=\s*(?:digest|encode|md5|sha)/iu);
  });

  it("pins monotonic concurrency and immutable-row enforcement in PostgreSQL", async () => {
    const sql = await readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");

    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("hashtextextended");
    expect(sql).toContain('COALESCE(MAX("revision"), 0) + 1');
    expect(sql).toContain("runtime_packages_revision_monotonic");
    expect(sql).toContain('CREATE TRIGGER "runtime_packages_no_update"');
    expect(sql).toContain('BEFORE UPDATE ON "runtime_packages"');
    expect(sql).toContain('CREATE TRIGGER "runtime_packages_no_delete"');
    expect(sql).toContain('BEFORE DELETE ON "runtime_packages"');
    expect(sql).toContain('CREATE TRIGGER "runtime_packages_no_truncate"');
    expect(sql).toContain('BEFORE TRUNCATE ON "runtime_packages"');
  });

  it("pins revision, digest, and legacy-identity constraints", async () => {
    const sql = await readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");

    expect(sql).toContain("runtime_packages_revision_positive");
    expect(sql).toContain("runtime_packages_identity_coherent");
    expect(sql).toContain('"content_digest" IS NOT NULL');
    expect(sql).toContain("runtime_packages_new_identity_content_sha256");
    expect(sql).toContain("NEW.\"identity_kind\" IS DISTINCT FROM 'content_sha256'");
    expect(sql).toContain("runtime_packages_venue_room_revision_unique");
    expect(sql).toContain("runtime_packages_venue_room_digest_unique");
    expect(sql).toContain("content_sha256");
    expect(sql).toContain("^[a-f0-9]{64}$");
  });

  it("remains before the journaled Foundry migration tail", async () => {
    const journalText = await readFile(resolve("drizzle", "meta", "_journal.json"), "utf8");
    const journal = JournalSchema.parse(JSON.parse(journalText) as unknown);

    expect(journal.entries.at(-7)?.tag).toBe(MIGRATION_TAG);
    expect(journal.entries.at(-6)?.tag).toBe("0053_foundry_execution_control");
    expect(journal.entries.at(-5)?.tag).toBe("0054_foundry_derivative_rights");
    expect(journal.entries.at(-4)?.tag).toBe("0055_foundry_derivative_rights_custody");
    expect(journal.entries.at(-3)?.tag).toBe("0056_foundry_derivative_execution_barrier");
    expect(journal.entries.at(-2)?.tag).toBe("0057_foundry_derivative_execution_candidates");
    expect(journal.entries.at(-1)?.tag).toBe("0058_foundry_derivative_activation_disabled");
    expect(journal.entries.at(-1)?.idx).toBe(journal.entries.length - 1);
  });
});
