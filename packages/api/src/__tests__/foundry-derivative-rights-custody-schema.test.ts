import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  foundryDerivativeRightsReviewsV1,
  foundryDerivativeTermsEvidenceCustodyV1,
} from "../db/schema.js";

const MIGRATION_TAG = "0055_foundry_derivative_rights_custody";
const IMMUTABLE_0053_SHA256 =
  "6950a3a230dd0d2181f33296dac3bb5ff42ebbe070e5bdcd4d651f8c737ffa34";
const IMMUTABLE_0054_SHA256 =
  "05e80543a52978c9b01ab277257ca7eed7bd8a2f37dbedfdeee06fa1c730bdb4";

const JournalSchema = z
  .object({
    entries: z.array(
      z
        .object({
          idx: z.number().int().nonnegative(),
          version: z.string(),
          when: z.number().int().positive(),
          tag: z.string(),
          breakpoints: z.boolean(),
        })
        .strict(),
    ),
  })
  .passthrough();

function withoutLineComments(sql: string): string {
  return sql.replace(/^--.*$/gmu, "");
}

function extractCreatedTableColumns(sql: string, tableName: string): string[] {
  const body = new RegExp(
    `CREATE TABLE "${tableName}" \\(([\\s\\S]*?)\\r?\\n\\);`,
    "u",
  ).exec(sql)?.[1];
  if (body === undefined)
    throw new Error(`Migration does not create table ${tableName}`);
  return [...body.matchAll(/^\s{2}"([^"]+)"\s/gmu)].map(
    (match) => match[1] ?? "",
  );
}

function drizzleColumnNames(
  table:
    | typeof foundryDerivativeTermsEvidenceCustodyV1
    | typeof foundryDerivativeRightsReviewsV1,
): string[] {
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  return Object.values(columns).map((column) => column.name);
}

describe("Foundry derivative-rights custody migration", () => {
  it("remains journaled before its additive successors and leaves 0053/0054 byte-identical", async () => {
    const [journalText, executionSql, derivativeSql] = await Promise.all([
      readFile(resolve("drizzle/meta/_journal.json"), "utf8"),
      readFile(resolve("drizzle/0053_foundry_execution_control.sql"), "utf8"),
      readFile(resolve("drizzle/0054_foundry_derivative_rights.sql"), "utf8"),
    ]);
    const journal = JournalSchema.parse(JSON.parse(journalText) as unknown);
    expect(journal.entries.at(-5)).toMatchObject({
      idx: 52,
      tag: "0054_foundry_derivative_rights",
    });
    expect(journal.entries.at(-4)).toMatchObject({
      idx: 53,
      tag: MIGRATION_TAG,
      version: "7",
      breakpoints: true,
    });
    expect(journal.entries.at(-3)?.tag).toBe("0056_foundry_derivative_execution_barrier");
    expect(journal.entries.at(-2)?.tag).toBe("0057_foundry_derivative_execution_candidates");
    expect(journal.entries.at(-1)?.tag).toBe("0058_foundry_derivative_activation_disabled");
    expect(createHash("sha256").update(executionSql).digest("hex")).toBe(
      IMMUTABLE_0053_SHA256,
    );
    expect(createHash("sha256").update(derivativeSql).digest("hex")).toBe(
      IMMUTABLE_0054_SHA256,
    );
  });

  it("creates only the authority-none custody and review tables declared by Drizzle", async () => {
    const sql = await readFile(
      resolve("drizzle", `${MIGRATION_TAG}.sql`),
      "utf8",
    );
    const createdTables = [...sql.matchAll(/^CREATE TABLE "([^"]+)"/gmu)].map(
      (match) => match[1] ?? "",
    );
    const tables = [
      foundryDerivativeTermsEvidenceCustodyV1,
      foundryDerivativeRightsReviewsV1,
    ] as const;
    expect(createdTables).toEqual(tables.map((table) => getTableName(table)));
    for (const table of tables) {
      expect(extractCreatedTableColumns(sql, getTableName(table))).toEqual(
        drizzleColumnNames(table),
      );
    }

    const executable = withoutLineComments(sql);
    for (const forbidden of [
      "foundry_executions",
      "foundry_execution_attempts",
      "foundry_prepared_provider_requests",
      "foundry_provider_commands",
      "reconstruction_releases",
      "reconstruction_release_publications",
    ]) {
      expect(executable).not.toContain(`"${forbidden}"`);
    }
    expect(executable).toContain("\"authority\" = 'none'");
    expect(executable).toContain('"execution_eligible" = false');
  });

  it("binds DB-computed bytes, DB timestamps, exact receipts, and a current platform-admin actor", async () => {
    const sql = await readFile(
      resolve("drizzle", `${MIGRATION_TAG}.sql`),
      "utf8",
    );
    expect(sql).toContain('"size_bytes" BETWEEN 1 AND 4194304');
    expect(sql).toContain('octet_length("evidence_bytes") = "size_bytes"');
    expect(sql).toContain(
      "'sha256:' || encode(sha256(\"evidence_bytes\"), 'hex')",
    );
    expect(sql).toContain('"captured_at" = "recorded_at"');
    expect(sql).toContain('NEW."captured_at" := database_now');
    expect(sql).toContain('NEW."custody_receipt_json" := expected_receipt');
    expect(sql).toContain('NEW."custody_receipt_sha256" :=');
    expect(sql).toContain("actor_platform_role IS DISTINCT FROM 'admin'");
    expect(sql).toContain("FOR SHARE;");
    expect(sql).toContain(
      'PERFORM "foundry_lock_derivative_rights_policy_version"',
    );
    expect(sql).toContain('NEW."reviewed_at" := database_now');
    expect(sql).toContain('NEW."review_receipt_json" := expected_receipt');
    expect(sql).toContain('NEW."review_receipt_sha256" :=');
    expect(sql).toContain(
      "superseded derivative-rights approval cannot be accepted",
    );
    expect(sql).toContain("accepted_for_registry_attestation");
    expect(sql).toContain(
      "expired derivative-rights approval cannot be accepted",
    );
    expect(sql).toContain(
      "revoked derivative-rights policy cannot be accepted",
    );
    expect(sql).toContain("foundry_ecmascript_domain_jsonb_sha256");
    expect(sql).not.toContain("database_now - interval '60 seconds'");

    const reviewGuard = sql.slice(
      sql.indexOf(
        'CREATE FUNCTION "guard_foundry_derivative_rights_review_v1"',
      ),
    );
    expect(
      reviewGuard.indexOf(
        'PERFORM "foundry_lock_derivative_rights_policy_version"',
      ),
    ).toBeLessThan(
      reviewGuard.indexOf("database_now := date_trunc('milliseconds'"),
    );
  });

  it("makes both evidence tables append-only and prevents artifact/review rebinding", async () => {
    const sql = await readFile(
      resolve("drizzle", `${MIGRATION_TAG}.sql`),
      "utf8",
    );
    expect(sql).toContain('UNIQUE("artifact_id")');
    expect(sql).toContain('UNIQUE("approval_id")');
    expect(sql).toContain(
      "\"idempotency_key\" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'",
    );
    expect(sql).toContain("[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}");
    for (const trigger of [
      "foundry_derivative_terms_custody_no_update",
      "foundry_derivative_terms_custody_no_delete",
      "foundry_derivative_terms_custody_no_truncate",
      "foundry_derivative_rights_reviews_no_update",
      "foundry_derivative_rights_reviews_no_delete",
      "foundry_derivative_rights_reviews_no_truncate",
    ]) {
      expect(sql).toContain(`CREATE TRIGGER "${trigger}"`);
    }
  });
});
