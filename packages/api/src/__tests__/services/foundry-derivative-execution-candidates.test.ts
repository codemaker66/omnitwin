import {
  FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REGISTRATION_REQUEST_V1,
  computeFoundryDerivativeRightsRegistryAttestationRegistrationRequestSha256,
} from "@omnitwin/types";
import { computeFoundryExecutionSubjectSha256 } from "@omnitwin/reconstruction-foundry";
import { describe, expect, it } from "vitest";
import type { Database } from "../../db/client.js";
import {
  FoundryDerivativeExecutionCandidateConflictError,
  FoundryDerivativeExecutionCandidateIntegrityError,
  FoundryDerivativeExecutionCandidateNotFoundError,
  FoundryDerivativeExecutionCandidatesService,
} from "../../services/foundry-derivative-execution-candidates.js";
import { FoundryExecutionSubjectBindingV0Schema } from "../../services/foundry-provider-request-authorization.js";

const ACTOR_ID = "10000000-0000-4000-8000-000000000004";
const REVIEW_ID = "10000000-0000-4000-8000-000000000005";
const CUSTODY_ID = "10000000-0000-4000-8000-000000000006";
const SHA = (character: string): string => `sha256:${character.repeat(64)}`;

interface FakeDatabaseState {
  readonly executeCalls: unknown[];
  selectCount: number;
  transactionCount: number;
}

interface FakeDatabase {
  select(): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(limit: number): Promise<readonly unknown[]>;
      };
    };
  };
  execute(query: unknown): Promise<unknown>;
  transaction<T>(callback: (tx: FakeDatabase) => Promise<T>): Promise<T>;
}

function fakeDatabase(options: {
  readonly selectResults?: readonly (readonly unknown[])[];
  readonly executeResults?: readonly unknown[];
} = {}): { readonly db: Database; readonly state: FakeDatabaseState } {
  const state: FakeDatabaseState = {
    executeCalls: [],
    selectCount: 0,
    transactionCount: 0,
  };
  let executeIndex = 0;
  const db: FakeDatabase = {
    select: () => ({
      from: (_table: unknown) => ({
        where: (_condition: unknown) => ({
          limit: (_limit: number) => {
            const result = options.selectResults?.[state.selectCount];
            state.selectCount += 1;
            if (result === undefined) {
              return Promise.reject(new Error("Unexpected fake database select."));
            }
            return Promise.resolve(result);
          },
        }),
      }),
    }),
    execute: (query: unknown) => {
      state.executeCalls.push(query);
      const result = options.executeResults?.[executeIndex];
      executeIndex += 1;
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result ?? { rows: [] });
    },
    transaction: <T>(callback: (tx: FakeDatabase) => Promise<T>) => {
      state.transactionCount += 1;
      return callback(db);
    },
  };
  return { db: db as never as Database, state };
}

function sqlText(query: unknown): string {
  const strings: string[] = [];
  const seen = new WeakSet();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      strings.push(value);
      return;
    }
    if (typeof value !== "object" || value === null || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    for (const entry of Object.values(value)) visit(entry);
  };
  visit(query);
  return strings.join(" ");
}

function attestationInput() {
  return {
    approvalId: "normalize-rights-approval",
    derivativeRightsApprovalSha256: SHA("1"),
    reviewId: REVIEW_ID,
    reviewReceiptSha256: SHA("2"),
    custodyId: CUSTODY_ID,
    custodyReceiptSha256: SHA("3"),
    idempotencyKey: "attestation-1",
  } as const;
}

function createBaseExecutionSubject() {
  return FoundryExecutionSubjectBindingV0Schema.parse({
    schemaVersion: "omnitwin.foundry.execution-subject.v0",
    subjectId: "normalize-envelope",
    projectId: "grand-hall",
    jobSpecSha256: SHA("a"),
    executionEnvelopeSha256: SHA("b"),
    ingestManifestSha256: SHA("c"),
    intakeAdmissionResultSha256: SHA("d"),
    intakeStagingIndexSha256: SHA("e"),
    providerPlanSha256: SHA("f"),
    executionPolicySha256: SHA("0"),
    executionConfirmationSha256: SHA("1"),
    rightsApprovalSha256: SHA("2"),
    rightsPolicyEvidenceSha256: SHA("3"),
    rightsPolicyDefinitionSha256: SHA("4"),
    computeApprovalSha256: null,
    providerKind: "local_cpu",
    providerAdapterId: "local-adapter",
    providerAdapterVersion: "1.0.0",
    providerAdapterArtifactSha256: SHA("5"),
    providerDeploymentSha256: SHA("6"),
    workerProfileSha256s: [SHA("7")],
    pricingSnapshotSha256: SHA("8"),
    pricingSnapshotExpiresAt: "2026-07-14T11:00:00.000Z",
    createdAt: "2026-07-14T10:00:00.000Z",
    dispatchDeadline: "2026-07-14T10:30:00.000Z",
    maximumAttempts: 1,
    budgetPolicy: {
      currency: "USD",
      costWarningMicroUsd: "500",
      costHardStopMicroUsd: "1000",
      terminationReserveMicroUsd: "100",
      absoluteCostCapMicroUsd: "2000",
      costObservationMaximumAgeSeconds: 60,
    },
    checkpointContract: null,
  });
}

function candidateInput() {
  const baseExecutionSubject = createBaseExecutionSubject();
  return {
    baseExecutionSubject,
    baseExecutionSubjectSha256:
      computeFoundryExecutionSubjectSha256(baseExecutionSubject),
    projectId: baseExecutionSubject.projectId,
    jobId: "normalize-job",
    jobSpecSha256: baseExecutionSubject.jobSpecSha256,
    executionEnvelopeSha256: baseExecutionSubject.executionEnvelopeSha256,
    ingestManifestSha256: baseExecutionSubject.ingestManifestSha256,
    jobSubjectSha256: SHA("9"),
    registryAttestationSha256: SHA("a"),
    bindingSetSha256: SHA("b"),
    restrictionLineageSetSha256: SHA("c"),
    outputPolicySha256: SHA("d"),
    idempotencyKey: "candidate-1",
  } as const;
}

describe("FoundryDerivativeExecutionCandidatesService", () => {
  it("recomputes and rejects a substituted base execution subject before opening a transaction", async () => {
    const { db, state } = fakeDatabase();
    const service = new FoundryDerivativeExecutionCandidatesService(db);
    await expect(
      service.reserveAuthorizationCandidate(
        { ...candidateInput(), baseExecutionSubjectSha256: SHA("f") },
        ACTOR_ID,
      ),
    ).rejects.toBeInstanceOf(FoundryDerivativeExecutionCandidateIntegrityError);
    expect(state.transactionCount).toBe(0);
    expect(state.executeCalls).toHaveLength(0);
  });

  it("maps semantic base-subject assertion failures to an integrity error", async () => {
    const { db, state } = fakeDatabase();
    const service = new FoundryDerivativeExecutionCandidatesService(db);
    const input = candidateInput();
    await expect(
      service.reserveAuthorizationCandidate(
        {
          ...input,
          baseExecutionSubject: {
            ...input.baseExecutionSubject,
            budgetPolicy: {
              ...input.baseExecutionSubject.budgetPolicy,
              costWarningMicroUsd: "1000",
              costHardStopMicroUsd: "1000",
            },
          },
        },
        ACTOR_ID,
      ),
    ).rejects.toBeInstanceOf(FoundryDerivativeExecutionCandidateIntegrityError);
    expect(state.transactionCount).toBe(0);
  });

  it("serializes idempotency before writes and rejects request-key rebinding", async () => {
    const existing = { registrationRequestSha256: SHA("f") };
    const { db, state } = fakeDatabase({ selectResults: [[existing]] });
    const service = new FoundryDerivativeExecutionCandidatesService(db);
    await expect(
      service.registerRegistryAttestation(attestationInput(), ACTOR_ID),
    ).rejects.toBeInstanceOf(FoundryDerivativeExecutionCandidateConflictError);
    expect(state.executeCalls).toHaveLength(2);
    expect(state.selectCount).toBe(1);
  });

  it("fails closed when an idempotent database row cannot reproduce canonical evidence", async () => {
    const input = attestationInput();
    const request = {
      schemaVersion:
        FOUNDRY_DERIVATIVE_RIGHTS_REGISTRY_ATTESTATION_REGISTRATION_REQUEST_V1,
      approvalId: input.approvalId,
      derivativeRightsApprovalSha256: input.derivativeRightsApprovalSha256,
      reviewId: input.reviewId,
      reviewReceiptSha256: input.reviewReceiptSha256,
      custodyId: input.custodyId,
      custodyReceiptSha256: input.custodyReceiptSha256,
    } as const;
    const existing = {
      registrationRequestSha256:
        computeFoundryDerivativeRightsRegistryAttestationRegistrationRequestSha256(
          request,
        ),
      registrationRequestJson: {},
    };
    const { db } = fakeDatabase({ selectResults: [[existing]] });
    const service = new FoundryDerivativeExecutionCandidatesService(db);
    await expect(
      service.registerRegistryAttestation(input, ACTOR_ID),
    ).rejects.toBeInstanceOf(FoundryDerivativeExecutionCandidateIntegrityError);
  });

  it("maps PostgreSQL uniqueness to conflict without touching execution or provider tables", async () => {
    const uniqueViolation = Object.assign(new Error("duplicate key"), {
      code: "23505",
    });
    const { db, state } = fakeDatabase({
      selectResults: [[]],
      executeResults: [undefined, undefined, uniqueViolation],
    });
    const service = new FoundryDerivativeExecutionCandidatesService(db);
    await expect(
      service.registerRegistryAttestation(attestationInput(), ACTOR_ID),
    ).rejects.toBeInstanceOf(FoundryDerivativeExecutionCandidateConflictError);
    const insert = sqlText(state.executeCalls[2]);
    expect(insert).toContain(
      "foundry_derivative_rights_registry_attestations_v1",
    );
    for (const forbidden of [
      "foundry_executions",
      "foundry_attempts",
      "foundry_provider_commands",
      "foundry_releases",
    ]) {
      expect(insert).not.toContain(forbidden);
    }
  });

  it("maps database source, policy, and role rejection to an integrity failure", async () => {
    for (const code of ["23503", "23514", "42501"]) {
      const rejected = Object.assign(new Error("database guard rejected row"), {
        code,
      });
      const { db } = fakeDatabase({
        selectResults: [[]],
        executeResults: [undefined, undefined, rejected],
      });
      const service = new FoundryDerivativeExecutionCandidatesService(db);
      await expect(
        service.registerRegistryAttestation(attestationInput(), ACTOR_ID),
      ).rejects.toBeInstanceOf(FoundryDerivativeExecutionCandidateIntegrityError);
    }
  });

  it("requires an exact stored attestation before reserving an inert candidate", async () => {
    const { db, state } = fakeDatabase({ selectResults: [[], []] });
    const service = new FoundryDerivativeExecutionCandidatesService(db);
    await expect(
      service.reserveAuthorizationCandidate(candidateInput(), ACTOR_ID),
    ).rejects.toBeInstanceOf(FoundryDerivativeExecutionCandidateNotFoundError);
    expect(state.executeCalls).toHaveLength(2);
    expect(state.selectCount).toBe(2);
  });
});
