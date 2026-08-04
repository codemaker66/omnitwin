import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_RESERVATION_REQUEST_V1,
  FOUNDRY_DERIVATIVE_EXECUTION_BINDING_SET_V1,
  FOUNDRY_DERIVATIVE_QUARANTINE_OUTPUT_POLICY_V1,
  FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_SET_V1,
  FoundryDerivativeExecutionAuthorizationCandidateV1Schema,
  FoundryDerivativeExecutionBindingSetV1Schema,
  FoundryDerivativeQuarantineOutputPolicyV1Schema,
  FoundryDerivativeRestrictionLineageSetV1Schema,
  FoundryDerivativeRightsRegistryAttestationRevocationRequestMaterialV1Schema,
  FoundryDerivativeRightsRegistryAttestationRevocationV1Schema,
  FoundryDerivativeRightsRegistryAttestationV1Schema,
  computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256,
  computeFoundryDerivativeExecutionBindingSetSha256,
  computeFoundryDerivativeQuarantineOutputPolicySha256,
  computeFoundryDerivativeRightsApprovalSha256,
  computeFoundryDerivativeRightsRegistryAttestationRevocationRequestSha256,
  computeFoundryDerivativeRightsRegistryAttestationRevocationSha256,
  computeFoundryDerivativeRestrictionLineageSetSha256,
} from "@omnitwin/types";
import { computeFoundryExecutionSubjectSha256 } from "@omnitwin/reconstruction-foundry";
import { FoundryExecutionSubjectBindingV0Schema } from "../services/foundry-provider-request-authorization.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptDirectory, "../..");
const migrationDirectory = join(apiDirectory, "drizzle");
const targetMigration = "0057_foundry_derivative_execution_candidates.sql";
const fixturePath = resolve(
  scriptDirectory,
  "../__tests__/fixtures/foundry-derivative-candidate-postgres.sql",
);
const postgresImageDigest =
  "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const postgresImage = `postgres:16.14-alpine@${postgresImageDigest}`;
const postgresPlatform = "linux/amd64";
const containerName = `omnitwin-foundry-v1-${String(process.pid)}-${randomUUID().slice(0, 8)}`;
const runToken = `${String(process.pid)}-${randomUUID().slice(0, 6)}`;
const databaseName = "omnitwin";
const databaseUser = "postgres";
const databasePassword = randomUUID();
let containerStarted = false;
let signalCleanupStarted = false;

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface PsqlSession {
  readonly completion: Promise<CommandResult>;
  readonly completed: () => boolean;
  readonly output: () => string;
  send(sql: string): void;
  closeInput(): void;
  terminateClient(): void;
  waitForOutput(marker: string, timeoutMs?: number): Promise<void>;
}

interface UngrantedLock {
  readonly locktype: string;
  readonly mode: string;
}

interface LockObservation {
  readonly scenario: string;
  readonly applicationName: string;
  readonly backendPid: number;
  readonly state: string;
  readonly waitEventType: string;
  readonly waitEvent: string;
  readonly ungrantedLocks: readonly UngrantedLock[];
}

interface DockerImageEvidence {
  readonly id: string;
  readonly repositoryDigest: string;
  readonly platform: string;
}

interface TimestampedDockerLogEvent {
  readonly timestamp: string;
  readonly orderKey: string;
  readonly message: string;
}

interface PostgresReadinessEvidence {
  readonly initializationCompleteLogTimestamp: string;
  readonly finalReadyLogTimestamp: string;
  readonly sqlProbe: {
    readonly database: string;
    readonly serverVersion: string;
    readonly postmasterStartedAt: string;
  };
}

interface GraphMaterial {
  readonly actorUserId: string;
  readonly baseExecutionSubjectSha256: string;
  readonly baseExecutionSubject: Record<string, unknown>;
  readonly projectId: string;
  readonly jobId: string;
  readonly jobSpecSha256: string;
  readonly executionEnvelopeSha256: string;
  readonly jobSubjectSha256: string;
  readonly ingestManifestSha256: string;
  readonly workerProfileSha256: string;
  readonly registryAttestationSha256: string;
  readonly registryAttestation: Record<string, unknown>;
}

interface CandidateInput {
  readonly graph: GraphMaterial;
  readonly request: Record<string, unknown>;
  readonly requestSha256: string;
}

function requireSuccess(result: CommandResult, label: string): string {
  if (result.code !== 0) {
    throw new Error(
      `${label} failed (${String(result.code)})\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

function runDocker(argumentsInput: readonly string[]): CommandResult {
  const result = spawnSync("docker", argumentsInput, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  return {
    code: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function dockerEndpointIsLocal(endpoint: string): boolean {
  return process.platform === "win32"
    ? endpoint.toLowerCase().startsWith("npipe://")
    : endpoint.toLowerCase().startsWith("unix://");
}

function requireLocalDockerDaemon(): {
  readonly context: string;
  readonly endpoint: string;
} {
  const configuredHost = process.env["DOCKER_HOST"];
  if (
    configuredHost !== undefined &&
    configuredHost.length > 0 &&
    !dockerEndpointIsLocal(configuredHost)
  ) {
    throw new Error(
      `refusing non-local DOCKER_HOST for disposable verification: ${configuredHost}`,
    );
  }
  const context = requireSuccess(runDocker(["context", "show"]), "Docker context");
  const endpointJson = requireSuccess(
    runDocker([
      "context",
      "inspect",
      context,
      "--format",
      "{{json .Endpoints.docker.Host}}",
    ]),
    "Docker context endpoint",
  );
  const endpointValue: unknown = JSON.parse(endpointJson);
  if (typeof endpointValue !== "string" || !dockerEndpointIsLocal(endpointValue)) {
    throw new Error(
      `refusing non-local Docker context ${context}: ${String(endpointValue)}`,
    );
  }
  return { context, endpoint: endpointValue };
}

function inspectPinnedPostgresImage(): DockerImageEvidence {
  const output = requireSuccess(
    runDocker(["image", "inspect", postgresImage]),
    "pinned PostgreSQL image inspection",
  );
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("pinned PostgreSQL image inspection returned an unexpected shape");
  }
  const inspected = parsed[0] as {
    readonly Id?: unknown;
    readonly RepoDigests?: unknown;
    readonly Os?: unknown;
    readonly Architecture?: unknown;
  };
  const repositoryDigest = `postgres@${postgresImageDigest}`;
  if (
    inspected.Id !== postgresImageDigest ||
    !Array.isArray(inspected.RepoDigests) ||
    !inspected.RepoDigests.includes(repositoryDigest) ||
    inspected.Os !== "linux" ||
    inspected.Architecture !== "amd64"
  ) {
    throw new Error(
      `pinned PostgreSQL image identity diverged: ${JSON.stringify(inspected)}`,
    );
  }
  return {
    id: inspected.Id,
    repositoryDigest,
    platform: postgresPlatform,
  };
}

function cleanupContainer(strict: boolean): void {
  if (!containerStarted) return;
  let result: CommandResult;
  try {
    result = runDocker(["rm", "-f", containerName]);
  } catch (error) {
    if (strict) throw error;
    process.stderr.write(
      `best-effort disposable PostgreSQL cleanup could not invoke Docker: ${String(error)}\n`,
    );
    return;
  }
  if (result.code !== 0) {
    if (strict) {
      throw new Error(
        `disposable PostgreSQL cleanup failed (${String(result.code)})\n${result.stderr || result.stdout}`,
      );
    }
    process.stderr.write(
      `best-effort disposable PostgreSQL cleanup failed: ${result.stderr || result.stdout}\n`,
    );
    return;
  }
  const inspection = runDocker([
    "container",
    "ls",
    "-a",
    "--filter",
    `name=^/${containerName}$`,
    "--format",
    "{{.Names}}",
  ]);
  if (inspection.code !== 0 || inspection.stdout.trim().length > 0) {
    if (strict) {
      throw new Error(
        `could not prove disposable PostgreSQL cleanup: ${inspection.stderr || inspection.stdout || containerName}`,
      );
    }
    process.stderr.write(
      `best-effort disposable PostgreSQL cleanup left container ${containerName}\n`,
    );
    return;
  }
  containerStarted = false;
}

function installSignalCleanup(): void {
  const handleSignal = (signal: NodeJS.Signals): void => {
    if (signalCleanupStarted) return;
    signalCleanupStarted = true;
    try {
      cleanupContainer(false);
    } finally {
      process.exit(signal === "SIGINT" ? 130 : 143);
    }
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
}

function psqlArguments(): string[] {
  return [
    "exec",
    "-i",
    "-e",
    "PGCONNECT_TIMEOUT=5",
    containerName,
    "psql",
    "-X",
    "-q",
    "-A",
    "-t",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    databaseUser,
    "-d",
    databaseName,
  ];
}

function openPsql(): PsqlSession {
  const child: ChildProcessWithoutNullStreams = spawn("docker", psqlArguments(), {
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let isCompleted = false;
  let inputClosed = false;
  const outputWaiters = new Map<
    string,
    { readonly resolve: () => void; readonly reject: (error: Error) => void }
  >();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    for (const [marker, waiter] of outputWaiters) {
      if (stdout.includes(marker)) {
        outputWaiters.delete(marker);
        waiter.resolve();
      }
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const completion = new Promise<CommandResult>((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      isCompleted = true;
      for (const waiter of outputWaiters.values()) {
        waiter.reject(
          new Error(`psql exited before its expected marker\n${stderr || stdout}`),
        );
      }
      outputWaiters.clear();
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
  const session: PsqlSession = {
    completion,
    completed: () => isCompleted,
    output: () => stdout,
    send(sql: string): void {
      if (isCompleted || inputClosed) {
        throw new Error("cannot send SQL to a closed psql session");
      }
      child.stdin.write(`${sql}\n`);
    },
    closeInput(): void {
      if (!inputClosed) {
        inputClosed = true;
        child.stdin.end();
      }
    },
    terminateClient(): void {
      if (!isCompleted) child.kill();
    },
    waitForOutput(marker: string, timeoutMs = 10_000): Promise<void> {
      if (stdout.includes(marker)) return Promise.resolve();
      if (isCompleted) {
        return Promise.reject(
          new Error(
            `psql exited before its expected marker ${marker}\n${stderr || stdout}`,
          ),
        );
      }
      return new Promise<void>((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          outputWaiters.delete(marker);
          rejectPromise(new Error(`timed out waiting for psql marker ${marker}`));
        }, timeoutMs);
        outputWaiters.set(marker, {
          resolve: () => {
            clearTimeout(timer);
            resolvePromise();
          },
          reject: (error) => {
            clearTimeout(timer);
            rejectPromise(error);
          },
        });
      });
    },
  };
  session.send("\\set VERBOSITY verbose");
  return session;
}

function startPsql(sql: string): PsqlSession {
  const session = openPsql();
  session.send(sql);
  session.send("\\q");
  session.closeInput();
  return session;
}

async function runPsql(sql: string, label: string): Promise<string> {
  const running = startPsql(sql);
  return requireSuccess(await running.completion, label);
}

async function assertSqlTrue(expression: string, label: string): Promise<void> {
  const result = await runPsql(
    `SELECT CASE WHEN (${expression}) THEN 'true' ELSE 'false' END;`,
    label,
  );
  if (result !== "true") {
    throw new Error(`${label} was not true in disposable PostgreSQL`);
  }
}

function markerBackendPid(session: PsqlSession, marker: string): number {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`${escapedMarker}:(\\d+)`, "u").exec(
    session.output(),
  );
  if (match?.[1] === undefined) {
    throw new Error(`missing backend pid for marker ${marker}`);
  }
  const backendPid = Number(match[1]);
  if (!Number.isSafeInteger(backendPid) || backendPid <= 0) {
    throw new Error(`invalid backend pid for marker ${marker}: ${match[1]}`);
  }
  return backendPid;
}

async function waitForBackendPid(
  session: PsqlSession,
  marker: string,
): Promise<number> {
  await session.waitForOutput(`${marker}:`);
  return markerBackendPid(session, marker);
}

async function observeRequiredLockWait(
  scenario: string,
  applicationName: string,
  backendPid: number,
  allowedLockTypes: ReadonlySet<string>,
): Promise<LockObservation> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const output = await runPsql(
      `SELECT jsonb_build_object(
        'scenario', ${sqlText(scenario)},
        'applicationName', activity.application_name,
        'backendPid', activity.pid,
        'state', activity.state,
        'waitEventType', activity.wait_event_type,
        'waitEvent', activity.wait_event,
        'ungrantedLocks', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'locktype', lock.locktype,
            'mode', lock.mode
          ) ORDER BY lock.locktype, lock.mode)
          FROM pg_locks lock
          WHERE lock.pid = activity.pid
            AND NOT lock.granted
        ), '[]'::jsonb)
      )::text
      FROM pg_stat_activity activity
      WHERE activity.pid = ${String(backendPid)}
        AND activity.application_name = ${sqlText(applicationName)}
        AND activity.state = 'active'
        AND activity.wait_event_type = 'Lock'
        AND EXISTS (
          SELECT 1
          FROM pg_locks lock
          WHERE lock.pid = activity.pid
            AND NOT lock.granted
        );`,
      `${scenario} lock observation`,
    );
    if (output.length > 0) {
      const observation = JSON.parse(output) as LockObservation;
      if (
        observation.backendPid !== backendPid ||
        observation.applicationName !== applicationName ||
        observation.waitEventType !== "Lock" ||
        observation.state !== "active" ||
        observation.ungrantedLocks.length === 0 ||
        !observation.ungrantedLocks.some((lock) =>
          allowedLockTypes.has(lock.locktype),
        )
      ) {
        throw new Error(
          `${scenario} observed an inappropriate lock wait: ${JSON.stringify(observation)}`,
        );
      }
      return observation;
    }
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(
    `${scenario} did not expose a pg_stat_activity/pg_locks wait within 10 seconds`,
  );
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlJson(value: unknown): string {
  return `${sqlText(JSON.stringify(value))}::jsonb`;
}

function timestampedDockerLogEvents(stream: string): TimestampedDockerLogEvent[] {
  const events: TimestampedDockerLogEvent[] = [];
  for (const line of stream.split(/\r?\n/u)) {
    const lineMatch = /^(\S+)\s(.*)$/u.exec(line);
    if (lineMatch?.[1] === undefined || lineMatch[2] === undefined) continue;
    const timestampMatch =
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/u.exec(
        lineMatch[1],
      );
    if (timestampMatch?.[1] === undefined) continue;
    const nanoseconds = (timestampMatch[2] ?? "").padEnd(9, "0");
    events.push({
      timestamp: lineMatch[1],
      orderKey: `${timestampMatch[1]}.${nanoseconds}Z`,
      message: lineMatch[2],
    });
  }
  return events;
}

function findFinalPostgresReadyLogEvidence(
  logs: CommandResult,
): Omit<PostgresReadinessEvidence, "sqlProbe"> | undefined {
  const events = [
    ...timestampedDockerLogEvents(logs.stdout),
    ...timestampedDockerLogEvents(logs.stderr),
  ];
  const initializationEvents = events
    .filter(
      (event) =>
        event.message.trim() ===
        "PostgreSQL init process complete; ready for start up.",
    )
    .sort((left, right) => left.orderKey.localeCompare(right.orderKey));
  const initializationEvent =
    initializationEvents[initializationEvents.length - 1];
  if (initializationEvent === undefined) return undefined;
  const finalReadyEvent = events
    .filter(
      (event) =>
        event.orderKey > initializationEvent.orderKey &&
        /LOG:\s+database system is ready to accept connections\s*$/u.test(
          event.message,
        ),
    )
    .sort((left, right) => left.orderKey.localeCompare(right.orderKey))[0];
  if (finalReadyEvent === undefined) return undefined;
  return {
    initializationCompleteLogTimestamp: initializationEvent.timestamp,
    finalReadyLogTimestamp: finalReadyEvent.timestamp,
  };
}

async function psqlCompletionWithin(
  session: PsqlSession,
  timeoutMs: number,
): Promise<CommandResult> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      session.completion,
      new Promise<never>((_resolvePromise, rejectPromise) => {
        timeout = setTimeout(() => {
          session.terminateClient();
          rejectPromise(
            new Error("final PostgreSQL SQL readiness probe timed out"),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function waitForPostgres(): Promise<PostgresReadinessEvidence> {
  const deadline = Date.now() + 60_000;
  let diagnostic = "no timestamped container logs observed";
  while (Date.now() < deadline) {
    const logs = runDocker(["logs", "--timestamps", containerName]);
    if (logs.code !== 0) {
      diagnostic = logs.stderr || logs.stdout;
    } else {
      const logEvidence = findFinalPostgresReadyLogEvidence(logs);
      if (logEvidence !== undefined) {
        const probe = startPsql(
          `SET statement_timeout = '5s';
          SELECT jsonb_build_object(
            'database', current_database(),
            'serverVersion', current_setting('server_version'),
            'postmasterStartedAt', pg_postmaster_start_time()
          )::text;`,
        );
        const remainingMs = Math.max(1, deadline - Date.now());
        try {
          const probeResult = await psqlCompletionWithin(
            probe,
            Math.min(5_000, remainingMs),
          );
          if (probeResult.code === 0) {
            const sqlProbe = JSON.parse(probeResult.stdout.trim()) as {
              readonly database?: unknown;
              readonly serverVersion?: unknown;
              readonly postmasterStartedAt?: unknown;
            };
            if (
              sqlProbe.database === databaseName &&
              sqlProbe.serverVersion === "16.14" &&
              typeof sqlProbe.postmasterStartedAt === "string" &&
              sqlProbe.postmasterStartedAt.length > 0
            ) {
              return {
                ...logEvidence,
                sqlProbe: {
                  database: sqlProbe.database,
                  serverVersion: sqlProbe.serverVersion,
                  postmasterStartedAt: sqlProbe.postmasterStartedAt,
                },
              };
            }
            diagnostic = `final SQL probe returned unexpected evidence: ${probeResult.stdout}`;
          } else {
            diagnostic = probeResult.stderr || probeResult.stdout;
          }
        } catch (error) {
          diagnostic = String(error);
        }
      } else {
        diagnostic = `${logs.stdout}\n${logs.stderr}`.slice(-4_000);
      }
    }
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(
    `disposable PostgreSQL final postmaster was not proven ready within 60 seconds\n${diagnostic}`,
  );
}

async function replayMigrations(): Promise<number> {
  const fileNames = (await readdir(migrationDirectory))
    .filter(
      (fileName) =>
        /^\d{4}_.+\.sql$/u.test(fileName) && fileName <= targetMigration,
    )
    .sort((left, right) => left.localeCompare(right));
  for (const fileName of fileNames) {
    const migration = await readFile(join(migrationDirectory, fileName), "utf8");
    await runPsql(`BEGIN;\n${migration}\nCOMMIT;`, `migration ${fileName}`);
  }
  return fileNames.length;
}

async function loadFixture(): Promise<void> {
  await runPsql(await readFile(fixturePath, "utf8"), "test fixture load");
}

async function createGraph(suffix: string, attested = true): Promise<void> {
  await runPsql(
    `SELECT foundry_test_create_derivative_graph(${sqlText(suffix)}, ${attested ? "true" : "false"});`,
    `source graph ${suffix}`,
  );
}

async function graphMaterial(suffix: string): Promise<GraphMaterial> {
  const result = await runPsql(
    `SELECT jsonb_build_object(
      'actorUserId', "actor_user_id"::text,
      'baseExecutionSubjectSha256', "base_execution_subject_sha256",
      'baseExecutionSubject', "base_execution_subject_json",
      'projectId', "project_id",
      'jobId', "job_id",
      'jobSpecSha256', "job_spec_sha256",
      'executionEnvelopeSha256', "execution_envelope_sha256",
      'jobSubjectSha256', "job_subject_sha256",
      'ingestManifestSha256', "ingest_manifest_sha256",
      'workerProfileSha256', "worker_profile_sha256",
      'registryAttestationSha256', "registry_attestation_sha256",
      'registryAttestation', "registry_attestation_json" || jsonb_build_object(
        'registryAttestationSha256', "registry_attestation_sha256"
      )
    )::text
    FROM "foundry_test_derivative_graph_material"
    WHERE "suffix" = ${sqlText(suffix)};`,
    `material query ${suffix}`,
  );
  if (result.length === 0) throw new Error(`source graph ${suffix} is absent`);
  return JSON.parse(result) as GraphMaterial;
}

function buildCandidateInput(graph: GraphMaterial): CandidateInput {
  const attestation =
    FoundryDerivativeRightsRegistryAttestationV1Schema.parse(
      graph.registryAttestation,
    );
  const approval = attestation.derivativeRightsApproval;
  const review = attestation.acceptedReviewReceipt;
  const custody = attestation.termsEvidenceCustodyReceipt;
  const assetId = approval.assetIds[0];
  if (assetId === undefined) throw new Error("attestation has no bound asset");
  const derivativeRightsApprovalSha256 =
    computeFoundryDerivativeRightsApprovalSha256(approval);
  const baseExecutionSubject = FoundryExecutionSubjectBindingV0Schema.parse(
    graph.baseExecutionSubject,
  );
  const executionSubjectSha256 =
    computeFoundryExecutionSubjectSha256(baseExecutionSubject);
  if (executionSubjectSha256 !== graph.baseExecutionSubjectSha256) {
    throw new Error("TypeScript and PostgreSQL base execution-subject digests diverged");
  }
  const bindingSet = FoundryDerivativeExecutionBindingSetV1Schema.parse({
    schemaVersion: FOUNDRY_DERIVATIVE_EXECUTION_BINDING_SET_V1,
    bindingIds: [approval.approvalId],
    assetIds: approval.assetIds,
    bindings: [
      {
        bindingId: approval.approvalId,
        baseExecutionSubjectSha256: graph.baseExecutionSubjectSha256,
        projectId: graph.projectId,
        jobId: graph.jobId,
        jobSpecSha256: graph.jobSpecSha256,
        executionEnvelopeSha256: graph.executionEnvelopeSha256,
        jobSubjectSha256: graph.jobSubjectSha256,
        ingestManifestSha256: graph.ingestManifestSha256,
        workerProfileSha256: graph.workerProfileSha256,
        operationClass: "deterministic_transformation",
        stageId: approval.stageId,
        operationId: approval.operation.operationId,
        derivativeClass: approval.operation.derivativeClass,
        assetId,
        policyVersion: approval.policyVersion,
        policyDefinitionSha256: approval.policyDefinitionSha256,
        policyGeneration: approval.policyGeneration,
        approvalId: approval.approvalId,
        derivativeRightsApprovalSha256,
        reviewId: review.reviewId,
        reviewReceiptSha256: review.reviewReceiptSha256,
        custodyId: custody.custodyId,
        custodyReceiptSha256: custody.custodyReceiptSha256,
        termsEvidenceArtifactId: custody.artifactId,
        termsEvidenceContentSha256: custody.contentSha256,
        termsEvidenceSizeBytes: custody.sizeBytes,
        termsEvidenceMediaType: custody.mediaType,
        termsEvidenceCapturedAt: custody.capturedAt,
        attestationId: attestation.attestationId,
        registryAttestationSha256: attestation.registryAttestationSha256,
      },
    ],
  });
  const bindingSetSha256 =
    computeFoundryDerivativeExecutionBindingSetSha256(bindingSet);
  const evidence = approval.assetRightsEvidence[0];
  if (evidence === undefined) throw new Error("attestation has no asset-rights evidence");
  const restrictionLineageSet =
    FoundryDerivativeRestrictionLineageSetV1Schema.parse({
      schemaVersion: FOUNDRY_DERIVATIVE_RESTRICTION_LINEAGE_SET_V1,
      approvalId: approval.approvalId,
      derivativeRightsApprovalSha256,
      reviewId: review.reviewId,
      reviewReceiptSha256: review.reviewReceiptSha256,
      custodyId: custody.custodyId,
      custodyReceiptSha256: custody.custodyReceiptSha256,
      attestationId: attestation.attestationId,
      registryAttestationSha256: attestation.registryAttestationSha256,
      bindingSetSha256,
      assetIds: approval.assetIds,
      entries: evidence.restrictionDispositions.map((restriction) => ({
        assetId,
        restriction,
        lineageDisposition: "preserve_on_quarantined_derivative",
      })),
    });
  const restrictionLineageSetSha256 =
    computeFoundryDerivativeRestrictionLineageSetSha256(
      restrictionLineageSet,
    );
  const outputPolicy = FoundryDerivativeQuarantineOutputPolicyV1Schema.parse({
    schemaVersion: FOUNDRY_DERIVATIVE_QUARANTINE_OUTPUT_POLICY_V1,
    outputDisposition: "quarantine_only",
    releaseEligible: false,
    publicationEligible: false,
    redistributionEligible: false,
    runtimePromotionEligible: false,
    signingEligible: false,
    restrictionLineageRequired: true,
    authorityRevalidationRequiredAtOutputCommit: true,
  });
  const outputPolicySha256 =
    computeFoundryDerivativeQuarantineOutputPolicySha256(outputPolicy);
  const request = {
    schemaVersion:
      FOUNDRY_DERIVATIVE_EXECUTION_AUTHORIZATION_CANDIDATE_RESERVATION_REQUEST_V1,
    baseExecutionSubjectSha256: graph.baseExecutionSubjectSha256,
    projectId: graph.projectId,
    jobId: graph.jobId,
    jobSpecSha256: graph.jobSpecSha256,
    executionEnvelopeSha256: graph.executionEnvelopeSha256,
    ingestManifestSha256: graph.ingestManifestSha256,
    jobSubjectSha256: graph.jobSubjectSha256,
    registryAttestationSha256: attestation.registryAttestationSha256,
    bindingSetSha256,
    restrictionLineageSetSha256,
    outputPolicySha256,
  };
  return {
    graph,
    request,
    requestSha256:
      computeFoundryDerivativeExecutionAuthorizationCandidateReservationRequestSha256(
        request,
      ),
  };
}

function candidateInsertSql(
  input: CandidateInput,
  idempotencyKey: string,
  returnCandidate = false,
): string {
  const attestation =
    FoundryDerivativeRightsRegistryAttestationV1Schema.parse(
      input.graph.registryAttestation,
    );
  const statement = `INSERT INTO "foundry_derivative_execution_authorization_candidates_v1" (
    "authority", "execution_eligible", "dispatch_enabled",
    "output_disposition", "approval_id",
    "derivative_rights_approval_sha256", "review_id",
    "review_receipt_sha256", "attestation_id",
    "registry_attestation_sha256", "base_execution_subject_sha256",
    "base_execution_subject_json", "job_id",
    "reservation_request_sha256", "reservation_request_json",
    "reserved_by_user_id", "idempotency_key"
  ) VALUES (
    'none', false, false, 'quarantine_only',
    ${sqlText(attestation.derivativeRightsApproval.approvalId)},
    ${sqlText(
      computeFoundryDerivativeRightsApprovalSha256(
        attestation.derivativeRightsApproval,
      ),
    )},
    ${sqlText(attestation.acceptedReviewReceipt.reviewId)}::uuid,
    ${sqlText(attestation.acceptedReviewReceipt.reviewReceiptSha256)},
    ${sqlText(attestation.attestationId)}::uuid,
    ${sqlText(attestation.registryAttestationSha256)},
    ${sqlText(input.graph.baseExecutionSubjectSha256)},
    ${sqlJson(input.graph.baseExecutionSubject)},
    ${sqlText(input.graph.jobId)},
    ${sqlText(input.requestSha256)}, ${sqlJson(input.request)},
    ${sqlText(input.graph.actorUserId)}::uuid, ${sqlText(idempotencyKey)}
  )`;
  if (!returnCandidate) return `${statement};`;
  return `${statement}
  RETURNING jsonb_build_object(
    'candidate', "candidate_json",
    'candidateSha256', "candidate_sha256",
    'authority', "authority",
    'executionEligible', "execution_eligible",
    'dispatchEnabled', "dispatch_enabled",
    'outputDisposition', "output_disposition"
  )::text;`;
}

function expectPostgresCode(result: CommandResult, code: string, label: string): void {
  if (result.code === 0 || !result.stderr.includes(code)) {
    throw new Error(
      `${label} did not fail with PostgreSQL ${code}\n${result.stderr || result.stdout}`,
    );
  }
}

async function runLockRace(options: {
  readonly scenario: string;
  readonly firstOperationSql: string;
  readonly secondOperationSql: string;
  readonly allowedSecondLockTypes: ReadonlySet<string>;
  readonly expectedSecondPostgresCode?: string;
}): Promise<LockObservation> {
  const applicationPrefix = `v1-${runToken}-${options.scenario}`.slice(0, 56);
  const firstApplicationName = `${applicationPrefix}-a`;
  const secondApplicationName = `${applicationPrefix}-b`;
  const firstReadyMarker = `${options.scenario}-first-ready`;
  const secondStartedMarker = `${options.scenario}-second-started`;
  const firstCommittedMarker = `${options.scenario}-first-committed`;
  const first = openPsql();
  let second: PsqlSession | undefined;
  try {
    first.send(`SET application_name = ${sqlText(firstApplicationName)};
      BEGIN;
      ${options.firstOperationSql}
      SELECT ${sqlText(`${firstReadyMarker}:`)} || pg_backend_pid();`);
    await waitForBackendPid(first, firstReadyMarker);
    if (first.completed()) {
      throw new Error(`${options.scenario} first session closed before controller commit`);
    }

    second = openPsql();
    second.send(`SET application_name = ${sqlText(secondApplicationName)};
      SELECT ${sqlText(`${secondStartedMarker}:`)} || pg_backend_pid();
      ${options.secondOperationSql}
      \\q`);
    second.closeInput();
    const secondBackendPid = await waitForBackendPid(
      second,
      secondStartedMarker,
    );
    if (second.completed()) {
      throw new Error(
        `${options.scenario} second session completed before lock observation`,
      );
    }
    const observation = await observeRequiredLockWait(
      options.scenario,
      secondApplicationName,
      secondBackendPid,
      options.allowedSecondLockTypes,
    );
    if (second.completed()) {
      throw new Error(
        `${options.scenario} second session completed during lock observation`,
      );
    }

    first.send(`COMMIT;
      SELECT ${sqlText(firstCommittedMarker)};
      \\q`);
    first.closeInput();
    await first.waitForOutput(firstCommittedMarker);
    requireSuccess(
      await first.completion,
      `${options.scenario} first transaction commit`,
    );
    const secondResult = await second.completion;
    if (options.expectedSecondPostgresCode === undefined) {
      requireSuccess(secondResult, `${options.scenario} second transaction`);
    } else {
      expectPostgresCode(
        secondResult,
        options.expectedSecondPostgresCode,
        `${options.scenario} second transaction`,
      );
    }
    return observation;
  } finally {
    if (!first.completed()) first.terminateClient();
    if (second !== undefined && !second.completed()) second.terminateClient();
  }
}

async function validateAttestationRevocation(suffix: string): Promise<void> {
  const output = await runPsql(
    `SELECT jsonb_build_object(
      'request', revocation."revocation_request_json",
      'requestSha256', revocation."revocation_request_sha256",
      'revocation', revocation."attestation_revocation_json" || jsonb_build_object(
        'attestationRevocationSha256',
          revocation."attestation_revocation_sha256"
      )
    )::text
    FROM "foundry_test_derivative_graphs" graph
    JOIN "foundry_derivative_rights_registry_attestation_revocations_v1" revocation
      ON revocation."attestation_id" = graph."attestation_id"
    WHERE graph."suffix" = ${sqlText(suffix)};`,
    `${suffix} attestation-revocation evidence`,
  );
  const evidence = JSON.parse(output) as {
    readonly request: unknown;
    readonly requestSha256: string;
    readonly revocation: Record<string, unknown>;
  };
  const request =
    FoundryDerivativeRightsRegistryAttestationRevocationRequestMaterialV1Schema.parse(
      evidence.request,
    );
  if (
    computeFoundryDerivativeRightsRegistryAttestationRevocationRequestSha256(
      request,
    ) !== evidence.requestSha256
  ) {
    throw new Error(`${suffix} attestation-revocation request digest diverged`);
  }
  const revocation =
    FoundryDerivativeRightsRegistryAttestationRevocationV1Schema.parse(
      evidence.revocation,
    );
  const { attestationRevocationSha256, ...material } = revocation;
  if (
    computeFoundryDerivativeRightsRegistryAttestationRevocationSha256(
      material,
    ) !== attestationRevocationSha256
  ) {
    throw new Error(`${suffix} attestation-revocation digest diverged`);
  }
}

async function main(): Promise<void> {
  installSignalCleanup();
  const docker = requireLocalDockerDaemon();
  const dockerServerVersion = requireSuccess(
    runDocker(["version", "--format", "{{.Server.Version}}"]),
    "Docker",
  );
  requireSuccess(
    runDocker([
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "--platform",
      postgresPlatform,
      "--label",
      `omnitwin.foundry-v1-verifier=${runToken}`,
      "-e",
      `POSTGRES_PASSWORD=${databasePassword}`,
      "-e",
      `POSTGRES_DB=${databaseName}`,
      postgresImage,
    ]),
    "disposable PostgreSQL start",
  );
  containerStarted = true;
  let report: Record<string, unknown> | undefined;
  try {
    const imageEvidence = inspectPinnedPostgresImage();
    const readiness = await waitForPostgres();
    const migrationCount = await replayMigrations();
    await loadFixture();
    const serverVersion = await runPsql("SHOW server_version;", "server version");
    if (serverVersion !== "16.14") {
      throw new Error(
        `disposable PostgreSQL version is ${serverVersion}; expected exactly 16.14`,
      );
    }
    const lockObservations: LockObservation[] = [];

    await createGraph("success");
    const successInput = buildCandidateInput(await graphMaterial("success"));
    const successResult = JSON.parse(
      await runPsql(
        candidateInsertSql(successInput, "success-candidate", true),
        "successful candidate reservation",
      ),
    ) as {
      readonly candidate: Record<string, unknown>;
      readonly candidateSha256: string;
      readonly authority: string;
      readonly executionEligible: boolean;
      readonly dispatchEnabled: boolean;
      readonly outputDisposition: string;
    };
    FoundryDerivativeExecutionAuthorizationCandidateV1Schema.parse({
      ...successResult.candidate,
      candidateSha256: successResult.candidateSha256,
    });
    if (
      successResult.authority !== "none" ||
      successResult.executionEligible ||
      successResult.dispatchEnabled ||
      successResult.outputDisposition !== "quarantine_only"
    ) {
      throw new Error("successful candidate escaped its authority-none inert boundary");
    }

    await createGraph("double");
    const doubleInput = buildCandidateInput(await graphMaterial("double"));
    lockObservations.push(
      await runLockRace({
        scenario: "double-reservation",
        firstOperationSql: candidateInsertSql(doubleInput, "double-first"),
        secondOperationSql: candidateInsertSql(doubleInput, "double-second"),
        allowedSecondLockTypes: new Set(["advisory"]),
        expectedSecondPostgresCode: "23505",
      }),
    );
    await assertSqlTrue(
      `(SELECT count(*) = 1
        FROM "foundry_derivative_execution_authorization_candidates_v1" candidate
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."attestation_id" = candidate."attestation_id"
        WHERE graph."suffix" = 'double')`,
      "double-reservation singleton",
    );

    await createGraph("candidate-first");
    const candidateFirstInput = buildCandidateInput(
      await graphMaterial("candidate-first"),
    );
    lockObservations.push(
      await runLockRace({
        scenario: "candidate-before-attestation-revocation",
        firstOperationSql: candidateInsertSql(
          candidateFirstInput,
          "candidate-first",
        ),
        secondOperationSql:
          "SELECT foundry_test_revoke_attestation('candidate-first', 'Fixture attestation was withdrawn after reservation.');",
        allowedSecondLockTypes: new Set(["transactionid", "tuple"]),
      }),
    );
    await assertSqlTrue(
      `(SELECT count(*) = 1
        FROM "foundry_derivative_execution_authorization_candidates_v1" candidate
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."attestation_id" = candidate."attestation_id"
        WHERE graph."suffix" = 'candidate-first')
       AND
       (SELECT count(*) = 1
        FROM "foundry_derivative_rights_registry_attestation_revocations_v1" revocation
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."attestation_id" = revocation."attestation_id"
        WHERE graph."suffix" = 'candidate-first')`,
      "candidate-before-attestation-revocation exact commits",
    );
    await validateAttestationRevocation("candidate-first");

    await createGraph("revocation-first");
    const revocationFirstInput = buildCandidateInput(
      await graphMaterial("revocation-first"),
    );
    lockObservations.push(
      await runLockRace({
        scenario: "attestation-revocation-before-candidate",
        firstOperationSql:
          "SELECT foundry_test_revoke_attestation('revocation-first', 'Fixture attestation was withdrawn before reservation.');",
        secondOperationSql: candidateInsertSql(
          revocationFirstInput,
          "revocation-first-candidate",
        ),
        allowedSecondLockTypes: new Set(["transactionid", "tuple"]),
        expectedSecondPostgresCode: "23514",
      }),
    );
    await assertSqlTrue(
      `(SELECT count(*) = 0
        FROM "foundry_derivative_execution_authorization_candidates_v1" candidate
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."attestation_id" = candidate."attestation_id"
        WHERE graph."suffix" = 'revocation-first')
       AND
       (SELECT count(*) = 1
        FROM "foundry_derivative_rights_registry_attestation_revocations_v1" revocation
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."attestation_id" = revocation."attestation_id"
        WHERE graph."suffix" = 'revocation-first')`,
      "attestation-revocation-before-candidate exact outcome",
    );
    await validateAttestationRevocation("revocation-first");

    await createGraph("policy-candidate-first");
    const policyCandidateFirstInput = buildCandidateInput(
      await graphMaterial("policy-candidate-first"),
    );
    lockObservations.push(
      await runLockRace({
        scenario: "candidate-before-policy-revocation",
        firstOperationSql: candidateInsertSql(
          policyCandidateFirstInput,
          "policy-candidate-first",
        ),
        secondOperationSql:
          "SELECT foundry_test_revoke_derivative_policy('policy-candidate-first');",
        allowedSecondLockTypes: new Set(["advisory"]),
      }),
    );
    await assertSqlTrue(
      `(SELECT count(*) = 1
        FROM "foundry_derivative_execution_authorization_candidates_v1" candidate
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."attestation_id" = candidate."attestation_id"
        WHERE graph."suffix" = 'policy-candidate-first')
       AND
       (SELECT count(*) = 1
        FROM "foundry_derivative_rights_policy_revocations" revocation
        JOIN "foundry_derivative_rights_approvals" approval
          ON revocation."policy_version" = approval."policy_version"
         AND revocation."policy_definition_sha256" = approval."policy_definition_sha256"
         AND revocation."policy_generation" = approval."policy_generation"
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."approval_id" = approval."approval_id"
        WHERE graph."suffix" = 'policy-candidate-first')`,
      "candidate-before-policy-revocation exact commits",
    );

    await createGraph("policy-revocation-first");
    const policyRevocationFirstInput = buildCandidateInput(
      await graphMaterial("policy-revocation-first"),
    );
    lockObservations.push(
      await runLockRace({
        scenario: "policy-revocation-before-candidate",
        firstOperationSql:
          "SELECT foundry_test_revoke_derivative_policy('policy-revocation-first');",
        secondOperationSql: candidateInsertSql(
          policyRevocationFirstInput,
          "policy-revocation-first-candidate",
        ),
        allowedSecondLockTypes: new Set(["advisory"]),
        expectedSecondPostgresCode: "23514",
      }),
    );
    await assertSqlTrue(
      `(SELECT count(*) = 0
        FROM "foundry_derivative_execution_authorization_candidates_v1" candidate
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."attestation_id" = candidate."attestation_id"
        WHERE graph."suffix" = 'policy-revocation-first')
       AND
       (SELECT count(*) = 1
        FROM "foundry_derivative_rights_policy_revocations" revocation
        JOIN "foundry_derivative_rights_approvals" approval
          ON revocation."policy_version" = approval."policy_version"
         AND revocation."policy_definition_sha256" = approval."policy_definition_sha256"
         AND revocation."policy_generation" = approval."policy_generation"
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."approval_id" = approval."approval_id"
        WHERE graph."suffix" = 'policy-revocation-first')`,
      "policy-revocation-before-candidate exact outcome",
    );

    await createGraph("generation-candidate-first");
    const generationCandidateFirstInput = buildCandidateInput(
      await graphMaterial("generation-candidate-first"),
    );
    lockObservations.push(
      await runLockRace({
        scenario: "candidate-before-policy-generation",
        firstOperationSql: candidateInsertSql(
          generationCandidateFirstInput,
          "generation-candidate-first",
        ),
        secondOperationSql:
          "SELECT foundry_test_add_derivative_policy_generation('generation-candidate-first');",
        allowedSecondLockTypes: new Set(["advisory"]),
      }),
    );
    await assertSqlTrue(
      `(SELECT count(*) = 1
        FROM "foundry_derivative_execution_authorization_candidates_v1" candidate
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."attestation_id" = candidate."attestation_id"
        WHERE graph."suffix" = 'generation-candidate-first')
       AND
       (SELECT count(*) = 1
        FROM "foundry_derivative_rights_policy_versions" policy
        JOIN "foundry_derivative_rights_approvals" approval
          ON approval."policy_version" = policy."policy_version"
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."approval_id" = approval."approval_id"
        WHERE graph."suffix" = 'generation-candidate-first'
          AND policy."generation" = 2)`,
      "candidate-before-policy-generation exact commits",
    );

    await createGraph("generation-first");
    const generationFirstInput = buildCandidateInput(
      await graphMaterial("generation-first"),
    );
    lockObservations.push(
      await runLockRace({
        scenario: "policy-generation-before-candidate",
        firstOperationSql:
          "SELECT foundry_test_add_derivative_policy_generation('generation-first');",
        secondOperationSql: candidateInsertSql(
          generationFirstInput,
          "generation-first-candidate",
        ),
        allowedSecondLockTypes: new Set(["advisory"]),
        expectedSecondPostgresCode: "23514",
      }),
    );
    await assertSqlTrue(
      `(SELECT count(*) = 0
        FROM "foundry_derivative_execution_authorization_candidates_v1" candidate
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."attestation_id" = candidate."attestation_id"
        WHERE graph."suffix" = 'generation-first')
       AND
       (SELECT count(*) = 1
        FROM "foundry_derivative_rights_policy_versions" policy
        JOIN "foundry_derivative_rights_approvals" approval
          ON approval."policy_version" = policy."policy_version"
        JOIN "foundry_test_derivative_graphs" graph
          ON graph."approval_id" = approval."approval_id"
        WHERE graph."suffix" = 'generation-first'
          AND policy."generation" = 2)`,
      "policy-generation-before-candidate exact outcome",
    );

    await createGraph("superseded", false);
    await runPsql(
      "SELECT foundry_test_add_derivative_policy_generation('superseded');",
      "superseding policy generation",
    );
    const supersededResult = await startPsql(
      "SELECT foundry_test_register_attestation('superseded');",
    ).completion;
    expectPostgresCode(
      supersededResult,
      "23514",
      "superseded-generation attestation",
    );
    await assertSqlTrue(
      `(SELECT "attestation_id" IS NULL
        FROM "foundry_test_derivative_graphs"
        WHERE "suffix" = 'superseded')`,
      "superseded-generation attestation absence",
    );
    await assertSqlTrue(
      `NOT EXISTS (
        SELECT 1
        FROM "foundry_derivative_execution_authorization_candidates_v1"
        WHERE "authority" <> 'none'
           OR "execution_eligible"
           OR "dispatch_enabled"
           OR "output_disposition" <> 'quarantine_only'
      )`,
      "all persisted candidates remain inert",
    );

    const counts = JSON.parse(
      await runPsql(
        `SELECT jsonb_build_object(
          'candidates', (
            SELECT count(*) FROM "foundry_derivative_execution_authorization_candidates_v1"
          ),
          'attestationRevocations', (
            SELECT count(*) FROM "foundry_derivative_rights_registry_attestation_revocations_v1"
          ),
          'policyRevocations', (
            SELECT count(*) FROM "foundry_derivative_rights_policy_revocations"
          ),
          'policyGenerationSupersessions', (
            SELECT count(*)
            FROM "foundry_derivative_rights_policy_versions"
            WHERE "generation" = 2
          )
        )::text;`,
        "final evidence counts",
      ),
    ) as Record<string, number>;
    if (
      counts["candidates"] !== 5 ||
      counts["attestationRevocations"] !== 2 ||
      counts["policyRevocations"] !== 2 ||
      counts["policyGenerationSupersessions"] !== 3
    ) {
      throw new Error(`unexpected final evidence counts: ${JSON.stringify(counts)}`);
    }

    const sideEffectCounts = JSON.parse(
      await runPsql(
        `SELECT jsonb_build_object(
          'foundry_executions', (SELECT count(*) FROM "foundry_executions"),
          'foundry_attempts', (SELECT count(*) FROM "foundry_attempts"),
          'foundry_stop_intents', (SELECT count(*) FROM "foundry_stop_intents"),
          'foundry_prepared_provider_requests', (
            SELECT count(*) FROM "foundry_prepared_provider_requests"
          ),
          'foundry_kill_switches', (SELECT count(*) FROM "foundry_kill_switches"),
          'foundry_kill_switch_events', (
            SELECT count(*) FROM "foundry_kill_switch_events"
          ),
          'foundry_execution_events', (
            SELECT count(*) FROM "foundry_execution_events"
          ),
          'foundry_provider_commands', (
            SELECT count(*) FROM "foundry_provider_commands"
          ),
          'foundry_provider_command_result_observations', (
            SELECT count(*) FROM "foundry_provider_command_result_observations"
          ),
          'foundry_provider_command_result_classifications', (
            SELECT count(*) FROM "foundry_provider_command_result_classifications"
          ),
          'foundry_cost_observations', (
            SELECT count(*) FROM "foundry_cost_observations"
          ),
          'foundry_verified_checkpoints', (
            SELECT count(*) FROM "foundry_verified_checkpoints"
          )
        )::text;`,
        "all runtime side-effect counts",
      ),
    ) as Record<string, number>;
    const nonzeroSideEffects = Object.entries(sideEffectCounts).filter(
      ([, count]) => count !== 0,
    );
    if (nonzeroSideEffects.length > 0) {
      throw new Error(
        `fixture wrote runtime authority state: ${JSON.stringify(sideEffectCounts)}`,
      );
    }

    report = {
      ok: true,
      docker: {
        context: docker.context,
        endpoint: docker.endpoint,
        serverVersion: dockerServerVersion,
      },
      postgres: serverVersion,
      image: {
        reference: postgresImage,
        ...imageEvidence,
      },
      readiness,
      migrations: migrationCount,
      successfulCandidateSha256: successResult.candidateSha256,
      races: {
        doubleReservation: "second_waited_then_23505_after_first_commit",
        candidateBeforeAttestationRevocation:
          "revocation_waited_then_both_commit",
        attestationRevocationBeforeCandidate:
          "candidate_waited_then_23514_after_revocation_commit",
        candidateBeforePolicyRevocation:
          "revocation_waited_then_both_commit",
        policyRevocationBeforeCandidate:
          "candidate_waited_then_23514_after_revocation_commit",
        candidateBeforePolicyGenerationSupersession:
          "generation_waited_then_both_commit",
        policyGenerationSupersessionBeforeCandidate:
          "candidate_waited_then_23514_after_generation_commit",
        supersededGenerationBeforeAttestation: "attestation_23514",
      },
      lockObservations,
      counts,
      sideEffectCounts,
      authority: "none",
      executionEligible: false,
      dispatchEnabled: false,
      outputDisposition: "quarantine_only",
    };
  } finally {
    cleanupContainer(true);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
