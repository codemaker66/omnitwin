import {
  HistoricalRuntimeSceneAuthorityReceiptSchema,
  HistoricalRuntimeSceneAuthoritySubjectSchema,
  HistoricalRuntimeSceneMapParserReceiptSchema,
  HistoricalRuntimeSceneMapVerificationHandleSchema,
  historicalRuntimeSceneAuthorityReceiptDigest,
  historicalRuntimeSceneAuthoritySubjectDigest,
  historicalRuntimeSceneMapParserReceiptDigest,
  historicalRuntimeSceneMapVerificationHandleDigest,
} from "@omnitwin/types";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_ENABLED = process.env["RUN_HISTORICAL_RUNTIME_SCENE_POSTGRES"] === "1";
const DATABASE_URL = process.env["HISTORICAL_RUNTIME_SCENE_DATABASE_URL"] ?? "";
const SAFE_DATABASE_PREFIX = "venviewer_hr_0066_";

function isSafeDisposableDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    const databaseName = parsed.pathname.slice(1);
    return (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
      && (parsed.port === "55429" || parsed.port === "55439")
      && databaseName.startsWith(SAFE_DATABASE_PREFIX)
      && /^[a-z0-9_]+$/u.test(databaseName);
  } catch {
    return false;
  }
}

if (RUN_ENABLED && !isSafeDisposableDatabaseUrl(DATABASE_URL)) {
  throw new Error(
    "RUN_HISTORICAL_RUNTIME_SCENE_POSTGRES requires a disposable local PostgreSQL database URL.",
  );
}

const run = RUN_ENABLED ? describe : describe.skip;

interface BodyRow {
  readonly body: unknown;
  readonly digest: string;
}

run("historical-runtime 0066 SQL body parity", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("strict-parses and independently recomputes parser, handle, subject, and final digests", async () => {
    const parserResult = await client.query<BodyRow>(`
      SELECT scene_map_verification_receipt_body AS body,
        scene_map_verification_receipt_digest AS digest
      FROM hr_scene_map_parser_receipts
      WHERE id='91000000-0000-0000-0000-000000000660'
    `);
    const handleResult = await client.query<BodyRow>(`
      SELECT scene_map_verification_receipt_body AS body,
        scene_map_verification_receipt_digest AS digest
      FROM hr_verified_scene_map_receipts
      WHERE parser_receipt_id='91000000-0000-0000-0000-000000000660'
    `);
    const subjectResult = await client.query<BodyRow>(`
      SELECT subject_body AS body,scene_validation_subject_digest AS digest
      FROM hr_scene_validation_subjects
      WHERE id='91000000-0000-0000-0000-000000000300'
    `);
    const finalResult = await client.query<BodyRow>(`
      SELECT scene_validation_body AS body,scene_validation_digest AS digest
      FROM hr_scene_validations
      WHERE id='91000000-0000-0000-0000-000000000300'
    `);

    expect(parserResult.rows).toHaveLength(1);
    expect(handleResult.rows).toHaveLength(1);
    expect(subjectResult.rows).toHaveLength(1);
    expect(finalResult.rows).toHaveLength(1);

    const parser = HistoricalRuntimeSceneMapParserReceiptSchema.parse(
      parserResult.rows[0]?.body,
    );
    const handle = HistoricalRuntimeSceneMapVerificationHandleSchema.parse(
      handleResult.rows[0]?.body,
    );
    const subject = HistoricalRuntimeSceneAuthoritySubjectSchema.parse(
      subjectResult.rows[0]?.body,
    );
    const final = HistoricalRuntimeSceneAuthorityReceiptSchema.parse(
      finalResult.rows[0]?.body,
    );
    const {
      sceneMapVerificationReceiptDigest: _parserDigest,
      ...parserMaterial
    } = parser;
    const {
      sceneMapVerificationReceiptDigest: _handleDigest,
      ...handleMaterial
    } = handle;
    const { sceneValidationSubjectDigest: _subjectDigest, ...subjectMaterial } =
      subject;
    const { sceneValidationDigest: _finalDigest, ...finalMaterial } = final;

    expect(historicalRuntimeSceneMapParserReceiptDigest(parserMaterial))
      .toBe(parserResult.rows[0]?.digest);
    expect(historicalRuntimeSceneMapVerificationHandleDigest(handleMaterial))
      .toBe(handleResult.rows[0]?.digest);
    expect(historicalRuntimeSceneAuthoritySubjectDigest(subjectMaterial))
      .toBe(subjectResult.rows[0]?.digest);
    expect(historicalRuntimeSceneAuthorityReceiptDigest(finalMaterial))
      .toBe(finalResult.rows[0]?.digest);
  });
});
