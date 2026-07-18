import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const MIGRATION_TAG = "0056_foundry_derivative_execution_barrier";
const IMMUTABLE_PREDECESSOR_SHA256 = {
  "0053_foundry_execution_control":
    "6950a3a230dd0d2181f33296dac3bb5ff42ebbe070e5bdcd4d651f8c737ffa34",
  "0054_foundry_derivative_rights":
    "05e80543a52978c9b01ab277257ca7eed7bd8a2f37dbedfdeee06fa1c730bdb4",
  "0055_foundry_derivative_rights_custody":
    "47602cf4ef2973a5e8588759519ca6cef3c7d7dd2f52c463ceea3eb4667db2e7",
} as const;

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

function normalized(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

function withoutLineComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gmu, "");
}

function extractFunction(sql: string, functionName: string): string {
  const statement = new RegExp(
    `CREATE FUNCTION "${functionName}"\\([\\s\\S]*?\\r?\\n\\$\\$;`,
    "u",
  ).exec(sql)?.[0];
  if (statement === undefined) {
    throw new Error(`Migration does not create function ${functionName}`);
  }
  return statement;
}

async function migrationSql(): Promise<string> {
  return readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");
}

describe("Foundry derivative execution V0 barrier migration", () => {
  it("is the journaled predecessor of 0057 and preserves 0053 through 0055 byte-for-byte", async () => {
    const [journalText, ...predecessorSql] = await Promise.all([
      readFile(resolve("drizzle/meta/_journal.json"), "utf8"),
      ...Object.keys(IMMUTABLE_PREDECESSOR_SHA256).map((tag) =>
        readFile(resolve("drizzle", `${tag}.sql`), "utf8"),
      ),
    ]);
    const journal = JournalSchema.parse(JSON.parse(journalText) as unknown);

    expect(journal.entries.at(-3)).toMatchObject({
      idx: 54,
      tag: MIGRATION_TAG,
      version: "7",
      breakpoints: true,
    });
    expect(journal.entries.at(-2)).toMatchObject({
      idx: 55,
      tag: "0057_foundry_derivative_execution_candidates",
    });
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 56,
      tag: "0058_foundry_derivative_activation_disabled",
    });
    for (const [index, expectedSha256] of Object.values(
      IMMUTABLE_PREDECESSOR_SHA256,
    ).entries()) {
      expect(createHash("sha256").update(predecessorSql[index] ?? "").digest("hex"))
        .toBe(expectedSha256);
    }
  });

  it("adds only functions and triggers and cannot confer authority", async () => {
    const executableSql = withoutLineComments(await migrationSql());

    expect(executableSql).not.toMatch(/\bCREATE\s+TABLE\b/iu);
    expect(executableSql).not.toMatch(/\bALTER\s+TABLE\b/iu);
    expect(executableSql).not.toMatch(/\bDROP\s+(?:TABLE|FUNCTION|TRIGGER|INDEX)\b/iu);
    expect(executableSql).not.toMatch(/\bINSERT\s+INTO\b/iu);
    expect(executableSql).not.toMatch(/\bDELETE\s+FROM\b/iu);
    expect(executableSql).not.toMatch(/\bGRANT\b/iu);
    expect(executableSql).not.toMatch(/\bSECURITY\s+DEFINER\b/iu);
    expect(executableSql).not.toContain('"authority"');
    expect(executableSql).not.toContain('"execution_eligible"');
  });

  it("classifies the immutable JobSpec with exact singleton-stage semantics", async () => {
    const classifier = extractFunction(
      await migrationSql(),
      "foundry_classify_normalize_mesh_glb_v0_job_spec",
    );
    const compact = normalized(classifier);

    expect(compact).toContain("LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE");
    expect(compact).toContain(
      `stage.value->'command' IS NOT DISTINCT FROM '["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb`,
    );
    expect(compact).toContain(
      `stage.value->>'kind' IS NOT DISTINCT FROM 'geometry'`,
    );
    expect(compact).toContain("INTO has_relevant_stage");
    expect(compact).toContain(
      `stage.value->>'networkAccess' IS NOT DISTINCT FROM 'none'`,
    );
    expect(compact).toContain(
      `stage.value->'rightsPurposes' IS NOT DISTINCT FROM '["commercial_internal_use"]'::jsonb`,
    );
    expect(compact).toContain(
      `jsonb_array_length(stage.value->'inputAssetIds') = 1`,
    );
    expect(compact).toContain(
      '"foundry_is_job_stage_array"(job_spec_input->\'stages\') IS NOT TRUE',
    );
    expect(compact).toContain(
      "relevant_stage_count = 1 AND exact_stage_count = 1",
    );
    expect(compact).toContain("RETURN 'normalize_mesh_glb_v0_exact'");
    expect(classifier).not.toContain('FROM "foundry_jobs"');
  });

  it("fails closed for geometry aliases, wrappers, malformed commands, and ambiguous variants", async () => {
    const classifier = normalized(extractFunction(
      await migrationSql(),
      "foundry_classify_normalize_mesh_glb_v0_job_spec",
    ));

    expect(classifier).toContain(
      "lower(argument.value #>> '{}') ~ 'normalize[_-]mesh[_-]glb'",
    );
    expect(classifier).toContain(
      "IF has_relevant_stage THEN RETURN 'normalize_mesh_glb_relevant_variant'",
    );
    expect(classifier).toContain(
      "stage.value->>'kind' IS NOT DISTINCT FROM 'geometry' OR stage.value->'command'",
    );
    expect(classifier).toContain("RETURN 'malformed_job_spec'");
    expect(classifier).toContain("IF relevant_stage_count = 0 THEN RETURN 'unrelated'");
    expect(classifier).toContain("RETURN 'normalize_mesh_glb_relevant_variant'");
  });

  it("resolves the immutable job and denies every classification except unrelated", async () => {
    const assertion = normalized(extractFunction(
      await migrationSql(),
      "assert_foundry_legacy_v0_derivative_execution_denied",
    ));

    expect(assertion).toContain(
      'FROM "foundry_jobs" job WHERE job."job_id" = job_id_input AND job."project_id" = project_id_input',
    );
    expect(assertion).toContain(
      '"foundry_classify_normalize_mesh_glb_v0_job_spec"(immutable_job_spec)',
    );
    expect(assertion).toContain(
      'FROM "foundry_job_worker_profiles" worker_binding',
    );
    expect(assertion).toContain(
      'worker_binding."operation_class" = \'deterministic_transformation\'',
    );
    expect(assertion).toContain("legacy_deterministic_transformation");
    expect(assertion).toContain(
      "IF job_classification IS DISTINCT FROM 'unrelated' THEN",
    );
    expect(assertion).toContain("USING ERRCODE = '23503'");
    expect(assertion).toContain("USING ERRCODE = '23514'");
  });

  it("places redundant barriers at every legacy activation boundary", async () => {
    const sql = await migrationSql();
    const compact = normalized(sql);
    const triggerTargets = [...sql.matchAll(
      /CREATE TRIGGER "([^"]+)"[\s\S]*?\bBEFORE (INSERT|UPDATE) ON "([^"]+)"/gu,
    )].map((match) => ({
      name: match[1] ?? "",
      event: match[2] ?? "",
      table: match[3] ?? "",
    }));

    expect(triggerTargets).toEqual([
      {
        name: "foundry_derivative_v0_execution_insert_barrier",
        event: "INSERT",
        table: "foundry_executions",
      },
      {
        name: "foundry_derivative_v0_attempt_insert_barrier",
        event: "INSERT",
        table: "foundry_attempts",
      },
      {
        name: "foundry_derivative_v0_prepared_request_insert_barrier",
        event: "INSERT",
        table: "foundry_prepared_provider_requests",
      },
      {
        name: "foundry_derivative_v0_provider_command_insert_barrier",
        event: "INSERT",
        table: "foundry_provider_commands",
      },
      {
        name: "foundry_derivative_v0_provider_command_claim_barrier",
        event: "UPDATE",
        table: "foundry_provider_commands",
      },
      {
        name: "foundry_derivative_v0_provider_invocation_event_insert_barrier",
        event: "INSERT",
        table: "foundry_execution_events",
      },
    ]);
    expect(compact).not.toContain('BEFORE UPDATE ON "foundry_executions"');
    expect(compact).not.toContain('BEFORE UPDATE ON "foundry_attempts"');
    expect(compact).not.toContain(
      'BEFORE UPDATE ON "foundry_prepared_provider_requests"',
    );
  });

  it("blocks only activation commands while preserving containment and completion", async () => {
    const sql = await migrationSql();
    const preparedInsert = normalized(extractFunction(
      sql,
      "guard_foundry_derivative_v0_prepared_request_insert",
    ));
    const commandInsert = normalized(extractFunction(
      sql,
      "guard_foundry_derivative_v0_provider_command_insert",
    ));
    const commandClaim = normalized(extractFunction(
      sql,
      "guard_foundry_derivative_v0_provider_command_claim",
    ));
    const invocationInsert = normalized(extractFunction(
      sql,
      "guard_foundry_derivative_v0_provider_invocation_event_insert",
    ));

    for (const insertGuard of [preparedInsert, commandInsert]) {
      expect(insertGuard).toContain(
        `NEW."command_kind" IN ('provider_submit', 'provider_checkpoint')`,
      );
      expect(insertGuard).not.toMatch(/provider_(?:stop|poll|reconcile)/u);
    }
    expect(commandClaim).toContain(
      `OLD."state" = 'pending' AND NEW."state" = 'claimed'`,
    );
    expect(commandClaim).toContain(
      `OLD."command_kind" IN ('provider_submit', 'provider_checkpoint')`,
    );
    expect(commandClaim).not.toMatch(/provider_(?:stop|poll|reconcile)/u);
    expect(commandClaim).not.toMatch(/succeeded|failed|uncertain|cancelled/u);
    expect(invocationInsert).toContain(
      `NEW."event_kind" = 'provider_invocation_started'`,
    );
    expect(invocationInsert).toContain(
      `NEW."provider_command_kind" IN ( 'provider_submit', 'provider_checkpoint' )`,
    );
    expect(invocationInsert).toContain(
      `NEW."job_id", NEW."project_id", 'activation_provider_invocation_started'`,
    );
    expect(invocationInsert).not.toMatch(/provider_(?:stop|poll|reconcile)/u);
    expect(invocationInsert).not.toMatch(
      /provider_command_(?:completed|transitioned)|observation/u,
    );
  });
});
