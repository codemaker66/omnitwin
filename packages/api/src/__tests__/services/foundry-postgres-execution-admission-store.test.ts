import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FOUNDRY_EXECUTION_SUBJECT_V0 } from "@omnitwin/reconstruction-foundry";
import {
  FOUNDRY_EXECUTION_ADMISSION_REQUEST_V0,
  FOUNDRY_EXECUTION_ADMISSION_STATE,
  type FoundryExecutionAdmissionInsert,
  type FoundryExecutionAdmissionRequestV0,
} from "../../services/foundry-execution-admission.js";
import {
  FoundryPostgresExecutionAdmissionStoreError,
  createPostgresFoundryExecutionAdmissionStore,
  type FoundryPostgresAdmissionClient,
  type FoundryPostgresAdmissionTransaction,
  type FoundryPostgresQueryResult,
  type FoundryPostgresRow,
} from "../../services/foundry-postgres-execution-admission-store.js";

const ADMIN_USER_ID = "10000000-0000-4000-8000-000000000001";
const EXECUTION_ID = "20000000-0000-4000-8000-000000000001";
const ADMITTED_AT = new Date("2026-07-13T10:04:00.000Z");

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

const JOB_SHA256 = digest("1");
const MANIFEST_SHA256 = digest("2");
const RESULT_SHA256 = digest("3");
const STAGING_SHA256 = digest("4");
const ENVELOPE_SHA256 = digest("5");
const POLICY_SHA256 = digest("6");
const PLAN_SHA256 = digest("7");
const DEPLOYMENT_SHA256 = digest("8");
const WORKER_SHA256 = digest("9");
const RIGHTS_SHA256 = digest("a");
const RIGHTS_POLICY_EVIDENCE_SHA256 = digest("b");
const RIGHTS_POLICY_DEFINITION_SHA256 = digest("c");
const CONFIRMATION_SHA256 = digest("d");
const COMPUTE_APPROVAL_SHA256 = digest("e");
const ADAPTER_ARTIFACT_SHA256 = digest("f");
const SUBJECT_SHA256 = digest("0");
const PRICING_SHA256 = digest("1");
const REQUEST_SHA256 = digest("2");

interface CapturedQuery {
  readonly text: string;
  readonly params: readonly unknown[];
}

type QueryStep =
  | { readonly rows: readonly FoundryPostgresRow[] }
  | { readonly error: Error };

interface ScriptedHarness {
  readonly client: FoundryPostgresAdmissionClient;
  readonly queries: CapturedQuery[];
  readonly transactionEvents: string[];
}

function scriptedHarness(...steps: readonly QueryStep[]): ScriptedHarness {
  const dialect = new PgDialect();
  const queries: CapturedQuery[] = [];
  const transactionEvents: string[] = [];
  let nextStep = 0;
  const transaction: FoundryPostgresAdmissionTransaction = {
    execute(query: SQL): Promise<FoundryPostgresQueryResult> {
      const compiled = dialect.sqlToQuery(query);
      queries.push({
        text: compiled.sql.replace(/\s+/gu, " ").trim(),
        params: compiled.params,
      });
      const step = steps[nextStep];
      nextStep += 1;
      if (step === undefined) {
        return Promise.reject(new Error("unexpected SQL query"));
      }
      if ("error" in step) return Promise.reject(step.error);
      return Promise.resolve({ rows: step.rows });
    },
  };
  return {
    queries,
    transactionEvents,
    client: {
      async transaction<T>(
        operation: (current: FoundryPostgresAdmissionTransaction) => Promise<T>,
      ): Promise<T> {
        transactionEvents.push("begin");
        try {
          const result = await operation(transaction);
          transactionEvents.push("commit");
          return result;
        } catch (error: unknown) {
          transactionEvents.push("rollback");
          throw error;
        }
      },
    },
  };
}

function request(): FoundryExecutionAdmissionRequestV0 {
  return {
    schemaVersion: FOUNDRY_EXECUTION_ADMISSION_REQUEST_V0,
    jobId: "job-001",
    executionEnvelopeId: "envelope-001",
    rightsApprovalId: "rights-001",
    confirmationId: "confirmation-001",
    computeApprovalId: "approval-001",
    idempotencyKey: "admit-001",
  };
}

function evidenceRow(): FoundryPostgresRow {
  return {
    job_id: "job-001",
    execution_envelope_id: "envelope-001",
    job_spec_sha256: JOB_SHA256,
    job_spec_json: { id: "job-001", projectId: "project-001" },
    reviewed_ingest_manifest_sha256: MANIFEST_SHA256,
    reviewed_ingest_manifest_json: { manifestSha256: MANIFEST_SHA256 },
    intake_admission_result_sha256: RESULT_SHA256,
    intake_admission_result_json: { resultSha256: RESULT_SHA256 },
    intake_staging_index_sha256: STAGING_SHA256,
    intake_staging_index_json: { stagingSha256: STAGING_SHA256.slice(7) },
    execution_envelope_sha256: ENVELOPE_SHA256,
    execution_envelope_json: {
      envelopeId: "envelope-001",
      projectId: "project-001",
      providerKind: "aws",
      providerAdapterId: "aws-batch",
      providerAdapterVersion: "1.2.3",
    },
    execution_policy_sha256: POLICY_SHA256,
    execution_policy_json: { policyId: "policy-001" },
    provider_plan_sha256: PLAN_SHA256,
    provider_plan_json: { planId: "plan-001" },
    provider_deployment_sha256: DEPLOYMENT_SHA256,
    provider_deployment_json: { deploymentId: "deployment-001" },
    trusted_worker_profiles: [{
      sha256: WORKER_SHA256,
      value: { profileId: "worker-001" },
    }],
    rights_approval_id: "rights-001",
    rights_approval_sha256: RIGHTS_SHA256,
    rights_approval_json: { decision: "allowed" },
    rights_policy_evidence_sha256: RIGHTS_POLICY_EVIDENCE_SHA256,
    rights_policy_json: { policyVersion: "rights-policy-001" },
    confirmation_id: "confirmation-001",
    confirmation_sha256: CONFIRMATION_SHA256,
    confirmation_json: { confirmationId: "confirmation-001" },
    compute_approval_id: "approval-001",
    compute_approval_sha256: COMPUTE_APPROVAL_SHA256,
    compute_approval_json: { approvalId: "approval-001" },
  };
}

function admissionInput(): FoundryExecutionAdmissionInsert {
  const executionSubject = {
    schemaVersion: FOUNDRY_EXECUTION_SUBJECT_V0,
    subjectId: "envelope-001",
    projectId: "project-001",
    jobSpecSha256: JOB_SHA256,
    executionEnvelopeSha256: ENVELOPE_SHA256,
    ingestManifestSha256: MANIFEST_SHA256,
    intakeAdmissionResultSha256: RESULT_SHA256,
    intakeStagingIndexSha256: STAGING_SHA256,
    providerPlanSha256: PLAN_SHA256,
    executionPolicySha256: POLICY_SHA256,
    executionConfirmationSha256: CONFIRMATION_SHA256,
    rightsApprovalSha256: RIGHTS_SHA256,
    rightsPolicyEvidenceSha256: RIGHTS_POLICY_EVIDENCE_SHA256,
    rightsPolicyDefinitionSha256: RIGHTS_POLICY_DEFINITION_SHA256,
    computeApprovalSha256: COMPUTE_APPROVAL_SHA256,
    providerKind: "aws",
    providerAdapterId: "aws-batch",
    providerAdapterVersion: "1.2.3",
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerDeploymentSha256: DEPLOYMENT_SHA256,
    workerProfileSha256s: [WORKER_SHA256],
    pricingSnapshotSha256: PRICING_SHA256,
    pricingSnapshotExpiresAt: "2026-07-13T11:00:00.000Z",
    createdAt: "2026-07-13T10:02:00.000Z",
    dispatchDeadline: "2026-07-13T10:10:00.000Z",
    maximumAttempts: 1,
    budgetPolicy: {
      currency: "USD",
      costWarningMicroUsd: "2000000",
      costHardStopMicroUsd: "3000000",
      terminationReserveMicroUsd: "500000",
      absoluteCostCapMicroUsd: "3500000",
      costObservationMaximumAgeSeconds: 60,
    },
    checkpointContract: null,
  } satisfies FoundryExecutionAdmissionInsert["executionSubject"];
  return {
    jobId: "job-001",
    executionEnvelopeId: "envelope-001",
    executionEnvelopeSha256: ENVELOPE_SHA256,
    executionSubject,
    executionSubjectSha256: SUBJECT_SHA256,
    jobSpecSha256: JOB_SHA256,
    reviewedIngestManifestSha256: MANIFEST_SHA256,
    intakeAdmissionResultSha256: RESULT_SHA256,
    intakeStagingIndexSha256: STAGING_SHA256,
    executionPolicySha256: POLICY_SHA256,
    providerPlanSha256: PLAN_SHA256,
    providerDeploymentSha256: DEPLOYMENT_SHA256,
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    trustedWorkerProfileSha256s: [WORKER_SHA256],
    rightsApprovalId: "rights-001",
    rightsApprovalSha256: RIGHTS_SHA256,
    rightsPolicyEvidenceSha256: RIGHTS_POLICY_EVIDENCE_SHA256,
    rightsPolicyDefinitionSha256: RIGHTS_POLICY_DEFINITION_SHA256,
    confirmationId: "confirmation-001",
    confirmationSha256: CONFIRMATION_SHA256,
    computeApprovalId: "approval-001",
    computeApprovalSha256: COMPUTE_APPROVAL_SHA256,
    providerKind: "aws",
    providerAdapterId: "aws-batch",
    providerAdapterVersion: "1.2.3",
    dispatchDeadline: new Date("2026-07-13T10:10:00.000Z"),
    reservedCostMicroUsd: "3500000",
    state: FOUNDRY_EXECUTION_ADMISSION_STATE,
    admittedByUserId: ADMIN_USER_ID,
    idempotencyKey: "admit-001",
    requestDigest: REQUEST_SHA256,
  };
}

function insertedExecutionRow(): FoundryPostgresRow {
  return {
    execution_id: EXECUTION_ID,
    job_id: "job-001",
    project_id: "project-001",
    execution_envelope_sha256: ENVELOPE_SHA256,
    execution_subject_sha256: SUBJECT_SHA256,
    provider_kind: "aws",
    provider_adapter_id: "aws-batch",
    provider_adapter_version: "1.2.3",
    provider_adapter_artifact_sha256: ADAPTER_ARTIFACT_SHA256,
    provider_deployment_sha256: DEPLOYMENT_SHA256,
    admitted_by_user_id: ADMIN_USER_ID,
    idempotency_key: "admit-001",
    request_digest: REQUEST_SHA256,
    admitted_at: ADMITTED_AT,
  };
}

describe("PostgreSQL Foundry execution-admission store", () => {
  it("opens one transaction, locks the exact job/envelope key, and uses the database clock", async () => {
    const harness = scriptedHarness(
      { rows: [] },
      { rows: [{ database_time: ADMITTED_AT }] },
      { rows: [] },
      { rows: [{
        execution_id: EXECUTION_ID,
        job_id: "job-001",
        execution_envelope_id: "envelope-001",
        execution_envelope_sha256: ENVELOPE_SHA256,
        state: FOUNDRY_EXECUTION_ADMISSION_STATE,
        admitted_by_user_id: ADMIN_USER_ID,
        idempotency_key: "admit-001",
        request_digest: REQUEST_SHA256,
        admitted_at: ADMITTED_AT,
      }] },
    );
    const store = createPostgresFoundryExecutionAdmissionStore(harness.client);

    const result = await store.withAdmissionLock(
      "job-001",
      "envelope-001",
      async (locked) => ({
        now: await locked.currentDatabaseTime(),
        replay: await locked.findIdempotentAdmission(
          ADMIN_USER_ID,
          "admit-001",
        ),
      }),
    );

    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
    expect(harness.queries).toHaveLength(4);
    expect(harness.queries[0]?.text).toContain("pg_advisory_xact_lock");
    expect(harness.queries[0]?.params).toEqual([
      "omnitwin.foundry.execution-admission.v0\u001fjob-001\u001fenvelope-001",
    ]);
    expect(harness.queries[1]?.text).toContain("clock_timestamp()");
    expect(harness.queries[2]?.text).toContain("pg_advisory_xact_lock");
    expect(harness.queries[2]?.params).toEqual([
      "omnitwin.foundry.execution-admission-idempotency.v0\u001f" +
        `${ADMIN_USER_ID}\u001fadmit-001`,
    ]);
    expect(harness.queries[3]?.text).toContain("execution.\"admitted_by_user_id\"");
    expect(harness.queries[3]?.params).toContain(ADMIN_USER_ID);
    expect(harness.queries[3]?.params).toContain("admit-001");
    expect(result.now).toEqual(ADMITTED_AT);
    expect(result.replay).toMatchObject({
      executionId: EXECUTION_ID,
      state: FOUNDRY_EXECUTION_ADMISSION_STATE,
      requestDigest: REQUEST_SHA256,
    });
  });

  it("loads the exact immutable evidence graph and worker-profile set", async () => {
    const harness = scriptedHarness({ rows: [] }, { rows: [evidenceRow()] });
    const store = createPostgresFoundryExecutionAdmissionStore(harness.client);

    const evidence = await store.withAdmissionLock(
      "job-001",
      "envelope-001",
      (locked) => locked.loadTrustedEvidence(request()),
    );

    const query = harness.queries[1];
    expect(query?.text).toContain("FROM \"foundry_jobs\" job");
    expect(query?.text).toContain("JOIN \"foundry_execution_policies\" policy");
    expect(query?.text).toContain("JOIN \"foundry_provider_deployments\" deployment");
    expect(query?.text).toContain("JOIN \"foundry_rights_approvals\" rights");
    expect(query?.text).toContain("JOIN \"foundry_rights_policy_versions\" rights_policy");
    expect(query?.text).toContain("JOIN \"foundry_execution_confirmations\" confirmation");
    expect(query?.text).toContain("LEFT JOIN \"foundry_compute_approvals\" compute_approval");
    expect(query?.text).toContain("JOIN \"foundry_trusted_worker_profiles\" trusted_profile");
    expect(query?.params).toEqual(expect.arrayContaining([
      "rights-001",
      "confirmation-001",
      "approval-001",
      "job-001",
      "envelope-001",
    ]));
    expect(evidence).toMatchObject({
      jobId: "job-001",
      executionEnvelopeId: "envelope-001",
      rightsApprovalId: "rights-001",
      confirmationId: "confirmation-001",
      computeApprovalId: "approval-001",
      trustedWorkerProfiles: [{ sha256: WORKER_SHA256 }],
    });
  });

  it("serializes kill activation with control-scope locks and checks every applicable scope", async () => {
    const harness = scriptedHarness(
      { rows: [] },
      { rows: [evidenceRow()] },
      { rows: [] },
      { rows: [{ id: "30000000-0000-4000-8000-000000000001", generation: "4" }] },
    );
    const store = createPostgresFoundryExecutionAdmissionStore(harness.client);

    const active = await store.withAdmissionLock(
      "job-001",
      "envelope-001",
      async (locked) => {
        const evidence = await locked.loadTrustedEvidence(request());
        if (evidence === null) throw new Error("missing fixture evidence");
        return locked.findActiveKillSwitch(evidence);
      },
    );

    expect(harness.queries[2]?.text).toContain(
      "foundry_lock_execution_control_scopes",
    );
    expect(harness.queries[2]?.params).toEqual([
      "aws",
      "aws-batch",
      "1.2.3",
      "project-001",
    ]);
    for (const scope of ["global", "provider", "project", "execution", "attempt"]) {
      expect(harness.queries[3]?.text).toContain(`'${scope}'`);
    }
    expect(active).toEqual({
      id: "30000000-0000-4000-8000-000000000001",
      generation: 4,
    });
  });

  it("inserts only an inert revision-zero execution and its genesis event", async () => {
    const harness = scriptedHarness(
      { rows: [] },
      { rows: [insertedExecutionRow()] },
      { rows: [{ execution_id: EXECUTION_ID, event_kind: "execution_admitted" }] },
    );
    const store = createPostgresFoundryExecutionAdmissionStore(harness.client);
    const input = admissionInput();

    const admitted = await store.withAdmissionLock(
      input.jobId,
      input.executionEnvelopeId,
      (locked) => locked.insertAdmission(input),
    );

    expect(harness.transactionEvents).toEqual(["begin", "commit"]);
    expect(harness.queries).toHaveLength(3);
    const projectionInsert = harness.queries[1];
    const eventInsert = harness.queries[2];
    expect(projectionInsert?.text).toContain("INSERT INTO \"foundry_executions\"");
    expect(projectionInsert?.text).toContain("clock_timestamp()");
    expect(projectionInsert?.text).toContain(
      "\"last_attempt_ordinal\", \"fencing_token\", \"total_cost_micro_usd\", \"cancel_requested\", \"revision\"",
    );
    expect(projectionInsert?.text).toContain(
      "admission_clock.\"admitted_at\", admission_clock.\"admitted_at\"",
    );
    expect(eventInsert?.text).toContain("INSERT INTO \"foundry_execution_events\"");
    expect(eventInsert?.text).toContain("FROM \"foundry_executions\" execution");
    expect(eventInsert?.text).toContain("1, 'execution_admitted', false");
    expect(eventInsert?.text).toContain("0, 0");
    expect(eventInsert?.text).toContain("execution.\"admitted_at\"");
    expect(eventInsert?.params.some((parameter) => parameter instanceof Date))
      .toBe(false);
    const mutationSql = `${projectionInsert?.text ?? ""} ${eventInsert?.text ?? ""}`;
    expect(mutationSql).not.toContain("INSERT INTO \"foundry_attempts\"");
    expect(mutationSql).not.toContain("INSERT INTO \"foundry_provider_commands\"");
    expect(mutationSql).not.toContain(
      "INSERT INTO \"foundry_prepared_provider_requests\"",
    );
    expect(admitted).toEqual({
      executionId: EXECUTION_ID,
      jobId: "job-001",
      executionEnvelopeId: "envelope-001",
      executionEnvelopeSha256: ENVELOPE_SHA256,
      state: FOUNDRY_EXECUTION_ADMISSION_STATE,
      admittedByUserId: ADMIN_USER_ID,
      idempotencyKey: "admit-001",
      requestDigest: REQUEST_SHA256,
      admittedAt: ADMITTED_AT,
    });
  });

  it("rolls the execution back when genesis-event insertion fails", async () => {
    const harness = scriptedHarness(
      { rows: [] },
      { rows: [insertedExecutionRow()] },
      { error: new Error("genesis rejected") },
    );
    const store = createPostgresFoundryExecutionAdmissionStore(harness.client);
    const input = admissionInput();

    await expect(store.withAdmissionLock(
      input.jobId,
      input.executionEnvelopeId,
      (locked) => locked.insertAdmission(input),
    )).rejects.toThrow("genesis rejected");
    expect(harness.transactionEvents).toEqual(["begin", "rollback"]);
  });

  it("fails closed before writing an event when exact evidence no longer selects a row", async () => {
    const harness = scriptedHarness({ rows: [] }, { rows: [] });
    const store = createPostgresFoundryExecutionAdmissionStore(harness.client);
    const input = admissionInput();

    await expect(store.withAdmissionLock(
      input.jobId,
      input.executionEnvelopeId,
      (locked) => locked.insertAdmission(input),
    )).rejects.toBeInstanceOf(FoundryPostgresExecutionAdmissionStoreError);
    expect(harness.queries).toHaveLength(2);
    expect(harness.transactionEvents).toEqual(["begin", "rollback"]);
  });

});
