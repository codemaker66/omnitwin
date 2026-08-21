import {
  HistoricalRuntimeReviewedProfileEvidenceSchema,
  HistoricalRuntimeReviewedProfileSubjectSchema,
  historicalRuntimeReviewedProfileEvidenceDigest,
  historicalRuntimeReviewedProfileSubjectDigest,
} from "@omnitwin/types";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_ENABLED = process.env["RUN_HISTORICAL_RUNTIME_PROFILE_POSTGRES"] === "1";
const DATABASE_URL = process.env["HISTORICAL_RUNTIME_PROFILE_DATABASE_URL"] ?? "";
const SAFE_DATABASE_PREFIX = "venviewer_hr_0067_";

function isSafeDisposableDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    const databaseName = parsed.pathname.slice(1);
    return (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
      && (parsed.port === "55529" || parsed.port === "55539")
      && databaseName.startsWith(SAFE_DATABASE_PREFIX)
      && /^[a-z0-9_]+$/u.test(databaseName);
  } catch {
    return false;
  }
}

if (RUN_ENABLED && !isSafeDisposableDatabaseUrl(DATABASE_URL)) {
  throw new Error(
    "RUN_HISTORICAL_RUNTIME_PROFILE_POSTGRES requires a disposable local PostgreSQL database URL.",
  );
}

const run = RUN_ENABLED ? describe : describe.skip;

interface BodyRow {
  readonly body: unknown;
  readonly digest: string;
}

run("historical-runtime 0067 SQL body parity", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("strict-parses and independently recomputes profile subject and final digests", async () => {
    const subjectResult = await client.query<BodyRow>(`
      SELECT subject_body AS body,reviewed_profile_subject_digest AS digest
      FROM hr_reviewed_profile_subjects
      WHERE id='91000000-0000-0000-0000-000000000401'
    `);
    const finalResult = await client.query<BodyRow>(`
      SELECT reviewed_profile_body AS body,
        reviewed_profile_evidence_digest AS digest
      FROM hr_reviewed_profiles
      WHERE id='91000000-0000-0000-0000-000000000401'
    `);

    expect(subjectResult.rows).toHaveLength(1);
    expect(finalResult.rows).toHaveLength(1);

    const subject = HistoricalRuntimeReviewedProfileSubjectSchema.parse(
      subjectResult.rows[0]?.body,
    );
    const final = HistoricalRuntimeReviewedProfileEvidenceSchema.parse(
      finalResult.rows[0]?.body,
    );
    const {
      reviewedProfileSubjectDigest: _subjectDigest,
      ...subjectMaterial
    } = subject;
    const {
      reviewedProfileEvidenceDigest: _finalDigest,
      ...finalMaterial
    } = final;

    expect(historicalRuntimeReviewedProfileSubjectDigest(subjectMaterial))
      .toBe(subjectResult.rows[0]?.digest);
    expect(historicalRuntimeReviewedProfileEvidenceDigest(finalMaterial))
      .toBe(finalResult.rows[0]?.digest);
  });
});
