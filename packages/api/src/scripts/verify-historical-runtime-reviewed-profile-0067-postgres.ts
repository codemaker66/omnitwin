import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { createHistoricalRuntimeScene0066Material } from
  "../__tests__/fixtures/historical-runtime-scene-0066-material.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptDirectory, "../..");
const workspaceDirectory = resolve(apiDirectory, "../..");
const migrationDirectory = join(apiDirectory, "drizzle");
const journalPath = join(migrationDirectory, "meta", "_journal.json");
const sceneFixturePath = resolve(
  scriptDirectory,
  "../__tests__/fixtures/historical-runtime-scene-0066-behavior.sql",
);
const profileFixturePath = resolve(
  scriptDirectory,
  "../__tests__/fixtures/historical-runtime-reviewed-profile-0067-behavior.sql",
);
const catalogFixturePath = resolve(
  scriptDirectory,
  "../__tests__/fixtures/historical-runtime-reviewed-profile-0067-catalog.sql",
);
const targetMigration = "0067_historical_runtime_reviewed_profiles";
const priorMigration = "0066_historical_runtime_verified_scene";
const targetMigrationBytes = 162_112;
const targetMigrationSha256 =
  "5fc17b64558d13c054a92db41785278ae534d296b86d55ac7b38b1073c8a23d3";
const postgresPlatform = "linux/amd64";

const images = Object.freeze([
  {
    major: 16,
    port: 55529,
    reference:
      "postgres:16@sha256:eb4759788a2182f08257135e61a34f2cfc3c2914079f3465d64ee62350f4d081",
    digest:
      "sha256:eb4759788a2182f08257135e61a34f2cfc3c2914079f3465d64ee62350f4d081",
    expectedVersionPrefix: "16.14",
  },
  {
    major: 17,
    port: 55539,
    reference:
      "postgres:17@sha256:e38411452a464af89e5adadb8d223bf53b898d47d6ef918b2d58c08707350449",
    digest:
      "sha256:e38411452a464af89e5adadb8d223bf53b898d47d6ef918b2d58c08707350449",
    expectedVersionPrefix: "17.11",
  },
] as const);

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

interface Journal {
  readonly entries: readonly JournalEntry[];
}

interface ImageConfig {
  readonly major: 16 | 17;
  readonly port: 55529 | 55539;
  readonly reference: string;
  readonly digest: string;
  readonly expectedVersionPrefix: string;
}

interface SceneFixturePhases {
  readonly upstream: string;
  readonly upstreamAfterScope: string;
  readonly sceneCommon: string;
  readonly local: string;
  readonly production: string;
}

interface ProfileFixturePhases {
  readonly profilePositive: string;
  readonly contradictoryQa: string;
  readonly contradictoryQaDecision: string;
  readonly contradictoryPackage: string;
  readonly contradictoryAdmission: string;
  readonly contradictorySceneAdmissionActor: string;
  readonly currentnessQaSuspended: string;
  readonly currentnessPackageSuspended: string;
  readonly currentnessSceneSuspended: string;
  readonly currentnessProfileAdmissionAttestationExpired: string;
  readonly currentnessSceneAdmissionAttestationExpired: string;
  readonly currentnessFinalSuspended: string;
}

const scenePhaseNames = [
  "upstream",
  "upstream-after-scope",
  "scene-common",
  "local",
  "production",
  "negative-seed",
] as const;
const profilePhaseNames = [
  "profile-positive",
  "contradictory-qa",
  "contradictory-qa-decision",
  "contradictory-package",
  "contradictory-admission",
  "currentness-qa-suspended",
  "currentness-package-suspended",
  "currentness-scene-suspended",
  "contradictory-scene-admission-actor",
  "currentness-profile-admission-attestation-expired",
  "currentness-scene-admission-attestation-expired",
  "currentness-final-suspended",
] as const;

const runToken = `${String(process.pid)}-${randomUUID().slice(0, 8)}`;
const postgresPassword = randomUUID();

function runCommand(
  command: string,
  argumentsInput: readonly string[],
  options: {
    readonly input?: string;
    readonly environment?: Readonly<NodeJS.ProcessEnv>;
    readonly cwd?: string;
  } = {},
): CommandResult {
  const result = spawnSync(command, argumentsInput, {
    cwd: options.cwd ?? workspaceDirectory,
    encoding: "utf8",
    env: options.environment ?? process.env,
    input: options.input,
    maxBuffer: 96 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  return {
    code: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function requireSuccess(result: CommandResult, label: string): string {
  if (result.code !== 0) {
    throw new Error(
      `${label} failed (${String(result.code)})\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

function errorFromUnknown(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function requireLocalDockerDaemon(): void {
  const configuredHost = process.env["DOCKER_HOST"];
  if (configuredHost !== undefined && configuredHost.length > 0) {
    const lower = configuredHost.toLowerCase();
    if (!lower.startsWith("npipe://") && !lower.startsWith("unix://")) {
      throw new Error(`refusing non-local DOCKER_HOST: ${configuredHost}`);
    }
  }
  const context = requireSuccess(
    runCommand("docker", ["context", "show"]),
    "Docker context",
  );
  const endpointText = requireSuccess(
    runCommand("docker", [
      "context",
      "inspect",
      context,
      "--format",
      "{{json .Endpoints.docker.Host}}",
    ]),
    "Docker endpoint",
  );
  const endpoint: unknown = JSON.parse(endpointText);
  if (
    typeof endpoint !== "string"
    || (!endpoint.toLowerCase().startsWith("npipe://")
      && !endpoint.toLowerCase().startsWith("unix://"))
  ) {
    throw new Error(`refusing non-local Docker context ${context}`);
  }
}

function runDocker(argumentsInput: readonly string[], input?: string): CommandResult {
  return runCommand("docker", argumentsInput, { input });
}

function psql(
  containerName: string,
  database: string,
  user: string,
  sql: string,
  variables: Readonly<Record<string, string>> = {},
): CommandResult {
  const variableArguments = Object.entries(variables).flatMap(([key, value]) => [
    "-v",
    `${key}=${value}`,
  ]);
  return runDocker([
    "exec",
    "-i",
    containerName,
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    "VERBOSITY=verbose",
    ...variableArguments,
    "-U",
    user,
    "-d",
    database,
    "-Atq",
  ], sql);
}

function assertFailure(
  result: CommandResult,
  label: string,
  sqlState: string,
  constraint: string,
): void {
  if (result.code === 0) throw new Error(`${label} unexpectedly succeeded`);
  const output = `${result.stderr}\n${result.stdout}`;
  if (!output.includes(sqlState) || !output.includes(constraint)) {
    throw new Error(`${label} missed ${sqlState}/${constraint}\n${output}`);
  }
}

function assertSqlStateFailure(
  result: CommandResult,
  label: string,
  sqlState: string,
): void {
  if (result.code === 0) throw new Error(`${label} unexpectedly succeeded`);
  const output = `${result.stderr}\n${result.stdout}`;
  if (!output.includes(sqlState)) {
    throw new Error(`${label} missed SQLSTATE ${sqlState}\n${output}`);
  }
}

function splitPhases<const Names extends readonly string[]>(
  sql: string,
  expectedNames: Names,
  fixtureLabel: string,
): ReadonlyMap<Names[number], string> {
  const matches = [...sql.matchAll(/^-- @phase ([a-z-]+)\r?$/gmu)];
  const sections = new Map<string, string>();
  for (const [index, match] of matches.entries()) {
    const name = match[1];
    if (name === undefined) continue;
    if (sections.has(name)) {
      throw new Error(`${fixtureLabel} repeats phase ${name}`);
    }
    const next = matches[index + 1];
    const start = match.index + match[0].length;
    const end = next?.index ?? sql.length;
    sections.set(name, sql.slice(start, end).trim());
  }
  const actualNames = [...sections.keys()];
  if (
    actualNames.length !== expectedNames.length
    || actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error(`${fixtureLabel} phase inventory drifted: ${actualNames.join(",")}`);
  }
  for (const name of expectedNames) {
    if ((sections.get(name)?.length ?? 0) === 0) {
      throw new Error(`${fixtureLabel} phase ${name} is empty`);
    }
  }
  return sections as ReadonlyMap<Names[number], string>;
}

function requiredPhase<Name extends string>(
  phases: ReadonlyMap<Name, string>,
  name: Name,
): string {
  const phase = phases.get(name);
  if (phase === undefined) throw new Error(`missing required phase ${name}`);
  return phase;
}

function splitSceneFixture(sql: string): SceneFixturePhases {
  const phases = splitPhases(sql, scenePhaseNames, "0066 Scene fixture");
  return {
    upstream: requiredPhase(phases, "upstream"),
    upstreamAfterScope: requiredPhase(phases, "upstream-after-scope"),
    sceneCommon: requiredPhase(phases, "scene-common"),
    local: requiredPhase(phases, "local"),
    production: requiredPhase(phases, "production"),
  };
}

function splitProfileFixture(sql: string): ProfileFixturePhases {
  const phases = splitPhases(sql, profilePhaseNames, "0067 profile fixture");
  return {
    profilePositive: requiredPhase(phases, "profile-positive"),
    contradictoryQa: requiredPhase(phases, "contradictory-qa"),
    contradictoryQaDecision: requiredPhase(phases, "contradictory-qa-decision"),
    contradictoryPackage: requiredPhase(phases, "contradictory-package"),
    contradictoryAdmission: requiredPhase(phases, "contradictory-admission"),
    contradictorySceneAdmissionActor:
      requiredPhase(phases, "contradictory-scene-admission-actor"),
    currentnessQaSuspended: requiredPhase(phases, "currentness-qa-suspended"),
    currentnessPackageSuspended:
      requiredPhase(phases, "currentness-package-suspended"),
    currentnessSceneSuspended: requiredPhase(phases, "currentness-scene-suspended"),
    currentnessProfileAdmissionAttestationExpired:
      requiredPhase(phases, "currentness-profile-admission-attestation-expired"),
    currentnessSceneAdmissionAttestationExpired:
      requiredPhase(phases, "currentness-scene-admission-attestation-expired"),
    currentnessFinalSuspended: requiredPhase(phases, "currentness-final-suspended"),
  };
}

async function loadMigrations(): Promise<readonly {
  readonly tag: string;
  readonly sql: string;
}[]> {
  const parsed: unknown = JSON.parse(await readFile(journalPath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("entries" in parsed)) {
    throw new Error("Drizzle journal has an unexpected shape");
  }
  const journal = parsed as Journal;
  const targetBytes = await readFile(
    join(migrationDirectory, `${targetMigration}.sql`),
  );
  const targetSha = createHash("sha256").update(targetBytes).digest("hex");
  if (targetBytes.byteLength !== targetMigrationBytes || targetSha !== targetMigrationSha256) {
    throw new Error(`0067 bytes drifted: ${targetSha}/${String(targetBytes.byteLength)}`);
  }
  const entries = [...journal.entries];
  const targetIndexes = entries.flatMap((entry, index) =>
    entry.tag === targetMigration ? [index] : [],
  );
  if (targetIndexes.length !== 1) {
    throw new Error("0067 must appear exactly once in the journal");
  }
  const [targetIndex] = targetIndexes;
  if (
    targetIndex !== entries.length - 1 ||
    entries[targetIndex - 1]?.tag !== priorMigration
  ) {
    throw new Error("0067 must be the exact journal tail immediately after 0066");
  }
  return Promise.all(entries.map(async (entry) => {
    const bytes = await readFile(join(migrationDirectory, `${entry.tag}.sql`));
    return { tag: entry.tag, sql: bytes.toString("utf8") };
  }));
}

function bootstrapSql(databaseName: string): string {
  return `
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'omnitwin_historical_schema_owner',
    'omnitwin_historical_evidence_owner',
    'omnitwin_historical_evidence_verifier',
    'omnitwin_historical_auth_gateway',
    'omnitwin_api_activation',
    'omnitwin_foundry_claimer',
    'omnitwin_foundry_submit_gateway',
    'omnitwin_foundry_recovery_gateway',
    'omnitwin_foundry_output_broker',
    'omnitwin_foundry_output_custodian',
    'omnitwin_foundry_watchdog'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT',role_name);
    END IF;
  END LOOP;
END;
$$;
CREATE ROLE venviewer_hr_0067_owner NOLOGIN NOINHERIT;
CREATE ROLE venviewer_hr_0067_migrator LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE venviewer_local_fixture_verifier LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE venviewer_prod_fixture_verifier LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE venviewer_prod_fixture_gateway LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE venviewer_prod_fixture_api LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE venviewer_bad_profile_super LOGIN NOINHERIT SUPERUSER;
CREATE ROLE venviewer_bad_profile_reader LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT omnitwin_historical_evidence_verifier
  TO venviewer_local_fixture_verifier WITH INHERIT FALSE,SET TRUE;
GRANT omnitwin_historical_evidence_verifier
  TO venviewer_prod_fixture_verifier WITH INHERIT FALSE,SET TRUE;
GRANT omnitwin_historical_auth_gateway
  TO venviewer_prod_fixture_gateway WITH INHERIT FALSE,SET TRUE;
GRANT omnitwin_api_activation
  TO venviewer_prod_fixture_api WITH INHERIT FALSE,SET TRUE;
GRANT omnitwin_historical_evidence_verifier
  TO venviewer_bad_profile_super WITH INHERIT FALSE,SET TRUE;
GRANT omnitwin_historical_evidence_verifier,pg_read_all_data
  TO venviewer_bad_profile_reader WITH INHERIT FALSE,SET TRUE;
CREATE DATABASE ${databaseName} OWNER venviewer_hr_0067_owner;
GRANT CONNECT,TEMPORARY,CREATE ON DATABASE ${databaseName}
  TO venviewer_hr_0067_migrator;
`;
}

function migrationBootstrapSql(): string {
  return `
GRANT USAGE,CREATE ON SCHEMA public
  TO venviewer_hr_0067_migrator WITH GRANT OPTION;
GRANT omnitwin_historical_schema_owner
  TO venviewer_hr_0067_migrator WITH INHERIT FALSE,SET TRUE;
GRANT omnitwin_historical_evidence_owner
  TO venviewer_hr_0067_migrator WITH INHERIT FALSE,SET TRUE;
`;
}

function externalFinallySql(databaseName: string): string {
  return `
REVOKE omnitwin_historical_schema_owner FROM venviewer_hr_0067_migrator;
REVOKE omnitwin_historical_evidence_owner FROM venviewer_hr_0067_migrator;
REVOKE USAGE,CREATE ON SCHEMA public
  FROM venviewer_hr_0067_migrator CASCADE;
REVOKE CREATE,TEMPORARY ON DATABASE ${databaseName}
  FROM venviewer_hr_0067_migrator;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename='venviewer_hr_0067_migrator' AND pid<>pg_backend_pid();
`;
}

function fixtureVariables(
  databaseName: string,
  profile: "local" | "production",
): Readonly<Record<string, string>> {
  return {
    fixture_db: databaseName,
    environment_mode: profile === "local" ? "test" : "production",
    provider_profile: profile === "local" ? "local_fixture" : "runtime_private",
    provider_kind:
      profile === "local" ? "local_fixture" : "content_addressed_immutable",
    version_kind:
      profile === "local" ? "local_fixture_version" : "content_addressed_immutable_key",
    verification_mode:
      profile === "local"
        ? "local_fixture_exact_version"
        : "content_addressed_no_overwrite_with_retention",
  };
}

function assertScopeClockFence(
  image: ImageConfig,
  containerName: string,
  databaseName: string,
  label: string,
): void {
  const output = requireSuccess(
    psql(containerName, databaseName, "postgres", `
SELECT public.fixture_wait_for_db_clock(scope.effective_at,:'clock_fence_label')
FROM public.hr_scope_epochs AS scope
WHERE scope.id='91000000-0000-0000-0000-000000000005';
WITH sample AS MATERIALIZED (
  SELECT public.hr_wall_clock_ms() AS observed_at,scope.effective_at
  FROM public.hr_scope_epochs AS scope
  WHERE scope.id='91000000-0000-0000-0000-000000000005'
)
SELECT concat_ws('|',observed_at>=effective_at,
  public.hr_iso_utc_ms(observed_at),public.hr_iso_utc_ms(effective_at))
FROM sample;
`, { clock_fence_label: label }),
    `PostgreSQL ${String(image.major)} ${label} DB-clock fence`,
  );
  const observation = output.split(/\r?\n/u).at(-1);
  if (observation?.split("|")[0] !== "t") {
    throw new Error(`PostgreSQL ${String(image.major)} ${label} clock regressed: ${String(observation)}`);
  }
}

function bodyParity(image: ImageConfig, databaseName: string): void {
  const url =
    `postgresql://postgres:${postgresPassword}@127.0.0.1:${String(image.port)}/${databaseName}`;
  const result = runCommand(process.execPath, [
    join(apiDirectory, "node_modules", "vitest", "vitest.mjs"),
    "run",
    "src/__tests__/historical-runtime-reviewed-profile-body-parity.test.ts",
  ], {
    cwd: apiDirectory,
    environment: {
      ...process.env,
      HISTORICAL_RUNTIME_PROFILE_DATABASE_URL: url,
      RUN_HISTORICAL_RUNTIME_PROFILE_POSTGRES: "1",
    },
  });
  requireSuccess(result, `PostgreSQL ${String(image.major)} profile body parity`);
  if (!result.stdout.includes("1 passed")) {
    throw new Error(`PostgreSQL ${String(image.major)} profile parity was skipped`);
  }
}

function profileCurrentnessSql(): string {
  return `
SET LOCAL ROLE omnitwin_historical_evidence_owner;
SELECT public.hr_assert_reviewed_profile_current(
  profile.id,profile.reviewed_profile_evidence_digest,
  profile.environment_id,profile.environment_mode,profile.environment_digest,
  profile.venue_id,profile.space_id,public.hr_wall_clock_ms()
)
FROM public.hr_reviewed_profiles AS profile
WHERE profile.id='91000000-0000-0000-0000-000000000401';
`;
}

const profileVectorSql = `
SELECT concat_ws('|',
  (SELECT count(*) FROM hr_reviewed_profile_subjects),
  (SELECT count(*) FROM hr_reviewed_profile_actors),
  (SELECT count(*) FROM hr_reviewed_profile_members),
  (SELECT count(*) FROM hr_reviewed_profiles),
  (SELECT count(*) FROM hr_role_attestations
   WHERE id IN (
     '91000000-0000-0000-0000-000000000742',
     '91000000-0000-0000-0000-000000000743',
     '91000000-0000-0000-0000-000000000746',
     '91000000-0000-0000-0000-000000000747',
     '91000000-0000-0000-0000-000000000748',
     '91000000-0000-0000-0000-000000000749',
     '91000000-0000-0000-0000-000000000750',
     '91000000-0000-0000-0000-000000000751'
   )),
  (SELECT count(*) FROM workspace_memberships
   WHERE id BETWEEN '91000000-0000-0000-0000-000000000046'::uuid
                AND '91000000-0000-0000-0000-000000000052'::uuid
     AND status='active')
);
`;

function assertProfileVector(
  image: ImageConfig,
  containerName: string,
  databaseName: string,
  label: string,
): void {
  const vector = requireSuccess(
    psql(containerName, databaseName, "postgres", profileVectorSql),
    `PostgreSQL ${String(image.major)} ${label} rollback vector`,
  ).split(/\r?\n/u).at(-1);
  if (vector !== "1|17|1|1|0|7") {
    throw new Error(`${label} changed durable profile state: ${String(vector)}`);
  }
}

function runSceneUpstream(
  image: ImageConfig,
  containerName: string,
  databaseName: string,
  profile: "local" | "production",
  fixture: SceneFixturePhases,
): Readonly<Record<string, string>> {
  const variables = fixtureVariables(databaseName, profile);
  requireSuccess(
    psql(containerName, databaseName, "postgres", fixture.upstream, variables),
    `PostgreSQL ${String(image.major)} ${profile} upstream fixture`,
  );
  assertScopeClockFence(image, containerName, databaseName, `${profile} post-scope`);
  requireSuccess(
    psql(
      containerName,
      databaseName,
      "postgres",
      fixture.upstreamAfterScope,
      variables,
    ),
    `PostgreSQL ${String(image.major)} ${profile} post-scope fixture`,
  );
  const memberRow = requireSuccess(
    psql(containerName, databaseName, "postgres", `
SELECT output_receipt_digest || '|' || to_char(
  receipt_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
)
FROM public.hr_derivation_members
WHERE derivation_id='91000000-0000-0000-0000-000000000200'
  AND member_index=0;
`),
    `PostgreSQL ${String(image.major)} ${profile} member receipt`,
  ).split(/\r?\n/u).at(-1);
  const [digest, expiresAt] = memberRow?.split("|") ?? [];
  if (digest === undefined || expiresAt === undefined) {
    throw new Error(`${profile} member receipt query returned no exact row`);
  }
  const material = createHistoricalRuntimeScene0066Material({ digest, expiresAt });
  const materialVariables = { ...variables, ...material.psqlVariables };
  assertScopeClockFence(
    image,
    containerName,
    databaseName,
    `${profile} Scene prerequisites`,
  );
  requireSuccess(
    psql(
      containerName,
      databaseName,
      "postgres",
      fixture.sceneCommon,
      materialVariables,
    ),
    `PostgreSQL ${String(image.major)} ${profile} Scene prerequisites`,
  );
  return materialVariables;
}

async function assertAdmissionLockOrder(
  image: ImageConfig,
  databaseName: string,
): Promise<void> {
  const connectionString =
    `postgresql://postgres:${postgresPassword}@127.0.0.1:${String(image.port)}/${databaseName}`;
  const first = new Client({ connectionString });
  const second = new Client({ connectionString });
  const observer = new Client({ connectionString });
  await Promise.all([first.connect(), second.connect(), observer.connect()]);
  const firstPid = (await first.query<{ readonly pid: number }>(
    "SELECT pg_backend_pid() AS pid",
  )).rows[0]?.pid;
  const secondPid = (await second.query<{ readonly pid: number }>(
    "SELECT pg_backend_pid() AS pid",
  )).rows[0]?.pid;
  if (firstPid === undefined || secondPid === undefined) {
    throw new Error("admission lock-order backend PID is absent");
  }
  const assertExactRowLocked = async (label: string): Promise<void> => {
    const row = await observer.query<{ readonly present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM hr_authority_lock_rows
        WHERE lock_namespace='runtime-presentation-admission'
          AND lock_key='91000000-0000-0000-0000-000000000706'
      ) AS present
    `);
    if (row.rows[0]?.present !== true) {
      throw new Error(`${label} exact protected authority row is absent`);
    }
    let lockFailure: unknown;
    try {
      await observer.query(`
        SELECT 1 FROM hr_authority_lock_rows
        WHERE lock_namespace='runtime-presentation-admission'
          AND lock_key='91000000-0000-0000-0000-000000000706'
        FOR UPDATE NOWAIT
      `);
    } catch (error: unknown) {
      lockFailure = error;
    }
    if (postgresErrorField(lockFailure, "code") !== "55P03") {
      throw new Error(`${label} exact protected row was not holder-locked`);
    }
  };
  const waitForObservedProtectedRow = async (
    label: string,
    blockerPid: number,
    waiterPid: number,
  ): Promise<void> => {
    const deadline = Date.now() + 5_000;
    let observed = false;
    while (Date.now() < deadline && !observed) {
      const state = await observer.query<{
        readonly wait_event_type: string | null;
        readonly blockers: readonly number[];
        readonly non_advisory_wait: boolean;
        readonly advisory_count: string;
      }>(`
        SELECT activity.wait_event_type,
          pg_blocking_pids(activity.pid) AS blockers,
          EXISTS (
            SELECT 1 FROM pg_locks AS lock_row
            WHERE lock_row.pid=activity.pid
              AND lock_row.locktype<>'advisory' AND NOT lock_row.granted
          ) AS non_advisory_wait,
          (SELECT count(*)::text FROM pg_locks AS lock_row
           WHERE lock_row.pid IN ($1,$2)
             AND lock_row.locktype='advisory') AS advisory_count
        FROM pg_stat_activity AS activity
        WHERE activity.pid=$2
      `, [blockerPid, waiterPid]);
      const row = state.rows[0];
      observed = row?.wait_event_type === "Lock"
        && row.non_advisory_wait
        && row.advisory_count === "0"
        && row.blockers.includes(blockerPid);
      if (!observed) {
        await new Promise((resolveWait) => {
          setTimeout(() => {
            resolveWait(undefined);
          }, 25);
        });
      }
    }
    if (!observed) {
      throw new Error(`${label} lacked a DB-observed protected-row wait`);
    }
  };
  try {
    await first.query("BEGIN");
    await first.query(`
      SELECT public.hr_lock_authority(
        'runtime-presentation-admission',
        '91000000-0000-0000-0000-000000000706'
      )
    `);
    await assertExactRowLocked(
      `PostgreSQL ${String(image.major)} revocation-first lock order`,
    );
    await second.query("BEGIN");
    const acceptanceAfterRevocation = second.query(`
      SET LOCAL statement_timeout='15s';
      ${profileCurrentnessSql()}
    `);
    await waitForObservedProtectedRow(
      `PostgreSQL ${String(image.major)} revocation-first lock order`,
      firstPid,
      secondPid,
    );
    await first.query("COMMIT");
    await acceptanceAfterRevocation;
    await second.query("COMMIT");

    await first.query("BEGIN");
    await first.query(profileCurrentnessSql());
    await assertExactRowLocked(
      `PostgreSQL ${String(image.major)} acceptance-first lock order`,
    );
    await second.query("BEGIN");
    const revocationAfterAcceptance = second.query(`
      SET LOCAL statement_timeout='15s';
      SELECT public.hr_lock_authority(
        'runtime-presentation-admission',
        '91000000-0000-0000-0000-000000000706'
      )
    `);
    await waitForObservedProtectedRow(
      `PostgreSQL ${String(image.major)} acceptance-first lock order`,
      firstPid,
      secondPid,
    );
    await first.query("COMMIT");
    await revocationAfterAcceptance;
    await second.query("COMMIT");
  } finally {
    await Promise.allSettled([
      first.query("ROLLBACK"),
      second.query("ROLLBACK"),
      observer.query("ROLLBACK"),
    ]);
    await Promise.allSettled([first.end(), second.end(), observer.end()]);
  }
}

function assertLoginBoundaries(
  image: ImageConfig,
  containerName: string,
  databaseName: string,
): void {
  for (const [login, capability] of [
    ["venviewer_prod_fixture_gateway", "omnitwin_historical_auth_gateway"],
    ["venviewer_prod_fixture_api", "omnitwin_api_activation"],
    ["venviewer_prod_fixture_verifier", "omnitwin_historical_evidence_verifier"],
    ["venviewer_local_fixture_verifier", "omnitwin_historical_evidence_verifier"],
  ] as const) {
    const identity = requireSuccess(
      psql(containerName, databaseName, login, `
SELECT concat_ws('|',session_user,current_user,session_user=current_user,
  pg_has_role(session_user,'${capability}','SET'),
  pg_has_role(session_user,'omnitwin_historical_schema_owner','MEMBER'),
  pg_has_role(session_user,'omnitwin_historical_evidence_owner','MEMBER')
);
`),
      `PostgreSQL ${String(image.major)} ${login} identity`,
    ).split(/\r?\n/u).at(-1);
    if (identity !== `${login}|${login}|t|t|f|f`) {
      throw new Error(`unexpected ${login} identity boundary: ${String(identity)}`);
    }
  }

  for (const login of [
    "venviewer_bad_profile_super",
    "venviewer_bad_profile_reader",
  ] as const) {
    const result = psql(containerName, databaseName, login, `
SET ROLE omnitwin_historical_evidence_verifier;
INSERT INTO hr_reviewed_profile_subjects DEFAULT VALUES;
`);
    assertFailure(
      result,
      `${login} verifier isolation`,
      "42501",
      "hr_trusted_evidence_verifier_isolation",
    );
  }

  for (const login of [
    "venviewer_prod_fixture_gateway",
    "venviewer_prod_fixture_api",
  ] as const) {
    const result = psql(
      containerName,
      databaseName,
      login,
      "INSERT INTO hr_reviewed_profile_subjects DEFAULT VALUES;",
    );
    assertSqlStateFailure(result, `${login} profile insert`, "42501");
  }
}

function assertTypedLeafs(
  image: ImageConfig,
  containerName: string,
  databaseName: string,
): void {
  const result = requireSuccess(
    psql(containerName, databaseName, "postgres", `
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_owner;
SELECT public.hr_assert_evidence_record_leaf_exact(
  '91000000-0000-0000-0000-000000000401'
);
  SELECT public.hr_assert_evidence_record_leaf_exact(
  '91000000-0000-0000-0000-000000000301'
);
COMMIT;
SELECT concat_ws('|',
  (SELECT record_kind FROM hr_evidence_records
   WHERE id='91000000-0000-0000-0000-000000000401'),
  (SELECT record_kind FROM hr_evidence_records
   WHERE id='91000000-0000-0000-0000-000000000301')
);
`),
    `PostgreSQL ${String(image.major)} typed-leaf exactness`,
  ).split(/\r?\n/u).at(-1);
  if (result !== "reviewed_profile|scene_validation") {
    throw new Error(`unexpected typed-leaf result: ${String(result)}`);
  }
}

const migrationBaselineSql = `
WITH profile_tables AS (
  SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname),'[]'::jsonb) AS body
  FROM pg_class AS c
  WHERE c.relnamespace='public'::regnamespace
    AND c.relname IN (
      'hr_reviewed_profile_subjects','hr_reviewed_profile_actors',
      'hr_reviewed_profile_members','hr_reviewed_profiles'
    )
), profile_functions AS (
  SELECT COALESCE(jsonb_agg(p.proname ORDER BY p.proname),'[]'::jsonb) AS body
  FROM pg_proc AS p
  WHERE p.pronamespace='public'::regnamespace
    AND p.proname IN (
      'hr_assert_profile_qa_reviewer_current',
      'hr_assert_profile_package_custodian_current',
      'hr_assert_profile_graph_complete','hr_profile_graph_deferred_guard',
      'hr_issue_reviewed_profile_subject',
      'hr_populate_reviewed_profile_children',
      'hr_assert_reviewed_profile_subject_current',
      'hr_assert_reviewed_profile_current','hr_issue_reviewed_profile'
    )
), legacy_constraints AS (
  SELECT COALESCE(jsonb_agg(con.conname ORDER BY con.conname),'[]'::jsonb) AS body
  FROM pg_constraint AS con
  WHERE con.conname IN (
    'hr_admissions_profile_leaf_unique',
    'hr_runtime_packages_profile_leaf_unique'
  )
), legacy_indexes AS (
  SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname),'[]'::jsonb) AS body
  FROM pg_class AS c
  WHERE c.relnamespace='public'::regnamespace
    AND c.relkind='i'
    AND c.relname IN (
      'hr_admissions_profile_leaf_unique',
      'hr_runtime_packages_profile_leaf_unique'
    )
), profile_triggers AS (
  SELECT COALESCE(jsonb_agg(t.tgname ORDER BY t.tgname),'[]'::jsonb) AS body
  FROM pg_trigger AS t
  JOIN pg_class AS c ON c.oid=t.tgrelid
  WHERE NOT t.tgisinternal
    AND c.relnamespace='public'::regnamespace
    AND c.relname IN (
      'hr_reviewed_profile_subjects','hr_reviewed_profile_actors',
      'hr_reviewed_profile_members','hr_reviewed_profiles'
    )
), parent_acls AS (
  SELECT jsonb_object_agg(c.relname,COALESCE(c.relacl::text,'NULL') ORDER BY c.relname)
    AS body
  FROM pg_class AS c
  WHERE c.relnamespace='public'::regnamespace
    AND c.relname IN (
      'hr_capture_clearances','hr_capture_content_subjects','hr_capture_roots',
      'hr_derivation_members','hr_derivations','hr_evidence_records',
      'hr_evidence_subjects','hr_rights_clearances','hr_role_attestations',
      'hr_scene_validation_members','hr_scene_validation_subjects',
      'hr_scene_validations','hr_transform_reviews'
    )
), leaf_function AS (
  SELECT jsonb_build_object(
    'definition',md5(pg_get_functiondef(p.oid)),
    'oid',p.oid::text,
    'owner',owner_role.rolname,
    'proacl',COALESCE(p.proacl::text,'NULL'),
    'proconfig',COALESCE(p.proconfig::text,'NULL'),
    'securityDefiner',p.prosecdef
  ) AS body
  FROM pg_proc AS p
  JOIN pg_roles AS owner_role ON owner_role.oid=p.proowner
  WHERE p.oid='public.hr_assert_evidence_record_leaf_exact(uuid)'::regprocedure
), helper_acl AS (
  SELECT jsonb_build_object(
    'oid',p.oid::text,'proacl',COALESCE(p.proacl::text,'NULL')
  ) AS body
  FROM pg_proc AS p
  WHERE p.oid='public.hr_uuid_array_is_distinct(uuid[])'::regprocedure
)
SELECT jsonb_build_object(
  'helperAcl',helper_acl.body,
  'leafFunction',leaf_function.body,
  'legacyConstraints',legacy_constraints.body,
  'legacyIndexes',legacy_indexes.body,
  'parentAcls',parent_acls.body,
  'profileFunctions',profile_functions.body,
  'profileTables',profile_tables.body,
  'profileTriggers',profile_triggers.body
)::text
FROM profile_tables,profile_functions,legacy_constraints,legacy_indexes,
  profile_triggers,parent_acls,leaf_function,helper_acl;
`;

function installPlpgsqlCheck(image: ImageConfig, containerName: string): void {
  const packageName = `postgresql-${String(image.major)}-plpgsql-check`;
  requireSuccess(
    runDocker([
      "exec",
      "--user",
      "root",
      containerName,
      "sh",
      "-ec",
      `apt-get update >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${packageName} >/dev/null`,
    ]),
    `PostgreSQL ${String(image.major)} plpgsql_check package`,
  );
}

function assertPlpgsqlCheck(
  image: ImageConfig,
  containerName: string,
  databaseName: string,
): void {
  const output = requireSuccess(
    psql(containerName, databaseName, "postgres", `
CREATE EXTENSION plpgsql_check;
WITH targets(signature,relation_name) AS (VALUES
  ('public.hr_assert_evidence_record_leaf_exact(uuid)',NULL::text),
  ('public.hr_assert_profile_qa_reviewer_current(uuid,uuid,uuid,uuid,text,text,uuid,uuid,timestamptz)',NULL),
  ('public.hr_assert_profile_package_custodian_current(uuid,uuid,uuid,uuid,text,text,uuid,uuid,timestamptz)',NULL),
  ('public.hr_assert_profile_graph_complete(uuid)',NULL),
  ('public.hr_profile_graph_deferred_guard()','hr_reviewed_profile_subjects'),
  ('public.hr_profile_graph_deferred_guard()','hr_reviewed_profile_actors'),
  ('public.hr_profile_graph_deferred_guard()','hr_reviewed_profile_members'),
  ('public.hr_profile_graph_deferred_guard()','hr_reviewed_profiles'),
  ('public.hr_issue_reviewed_profile_subject()','hr_reviewed_profile_subjects'),
  ('public.hr_populate_reviewed_profile_children()','hr_reviewed_profile_subjects'),
  ('public.hr_assert_reviewed_profile_subject_current(uuid,timestamptz)',NULL),
  ('public.hr_assert_reviewed_profile_current(uuid,text,uuid,text,text,uuid,uuid,timestamptz)',NULL),
  ('public.hr_issue_reviewed_profile()','hr_reviewed_profiles')
), diagnostics AS (
  SELECT target.signature,target.relation_name,checked.*
  FROM targets AS target
  CROSS JOIN LATERAL plpgsql_check_function_tb(
    target.signature::regprocedure,
    relid => CASE WHEN target.relation_name IS NULL THEN 0::oid
                  ELSE target.relation_name::regclass::oid END,
    fatal_errors => true,other_warnings => true,
    extra_warnings => true,security_warnings => true,
    compatibility_warnings => true,performance_warnings => false
  ) AS checked
)
SELECT jsonb_build_object(
  'diagnosticCount',(SELECT count(*) FROM diagnostics),
  'diagnostics',COALESCE(
    (SELECT jsonb_agg(to_jsonb(diagnostics)) FROM diagnostics),'[]'::jsonb
  ),
  'extensionVersion',(SELECT extversion FROM pg_extension
                      WHERE extname='plpgsql_check'),
  'targetContextCount',(SELECT count(*) FROM targets)
)::text;
`),
    `PostgreSQL ${String(image.major)} plpgsql_check`,
  ).split(/\r?\n/u).at(-1);
  if (
    output === undefined
    || !output.includes('"diagnosticCount": 0')
    || !output.includes('"targetContextCount": 13')
  ) {
    throw new Error(`PostgreSQL ${String(image.major)} plpgsql_check diagnostics: ${String(output)}`);
  }
}

function postgresErrorField(error: unknown, field: "code" | "constraint"): string | undefined {
  if (typeof error !== "object" || error === null || !(field in error)) return undefined;
  const value = (error as Readonly<Record<string, unknown>>)[field];
  return typeof value === "string" ? value : undefined;
}

async function assertFreshClockAfterObservedLockWait(
  image: ImageConfig,
  containerName: string,
  sourceDatabase: string,
): Promise<void> {
  const expiryDatabase = `venviewer_hr_0067_expiry_${String(image.major)}`;
  requireSuccess(
    psql(containerName, "postgres", "postgres", `
CREATE DATABASE ${expiryDatabase} TEMPLATE ${sourceDatabase}
  OWNER venviewer_hr_0067_owner;
`),
    `PostgreSQL ${String(image.major)} expiry-race database`,
  );
  requireSuccess(
    psql(containerName, expiryDatabase, "postgres", `
BEGIN;
ALTER TABLE hr_scope_epochs DROP CONSTRAINT hr_scope_epochs_shape;
SET LOCAL session_replication_role=replica;
UPDATE hr_scope_epochs
SET expires_at=public.hr_wall_clock_ms() + interval '8 seconds'
WHERE id='91000000-0000-0000-0000-000000000005';
SET LOCAL session_replication_role=origin;
COMMIT;
`),
    `PostgreSQL ${String(image.major)} expiry-race seed`,
  );

  const connectionString =
    `postgresql://postgres:${postgresPassword}@127.0.0.1:${String(image.port)}/${expiryDatabase}`;
  const holder = new Client({ connectionString });
  const waiter = new Client({ connectionString });
  const observer = new Client({ connectionString });
  await Promise.all([holder.connect(), waiter.connect(), observer.connect()]);
  try {
    await holder.query("BEGIN");
    const holderPidResult = await holder.query<{ readonly pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const holderPid = holderPidResult.rows[0]?.pid;
    if (holderPid === undefined) throw new Error("lock holder PID is absent");
    await holder.query(`
      SELECT public.hr_lock_authority(
        'runtime-presentation-admission',
        '91000000-0000-0000-0000-000000000706'
      )
    `);
    const exactRow = await observer.query<{ readonly present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM hr_authority_lock_rows
        WHERE lock_namespace='runtime-presentation-admission'
          AND lock_key='91000000-0000-0000-0000-000000000706'
      ) AS present
    `);
    if (exactRow.rows[0]?.present !== true) {
      throw new Error("fresh-clock exact protected authority row is absent");
    }
    let exactLockFailure: unknown;
    try {
      await observer.query(`
        SELECT 1 FROM hr_authority_lock_rows
        WHERE lock_namespace='runtime-presentation-admission'
          AND lock_key='91000000-0000-0000-0000-000000000706'
        FOR UPDATE NOWAIT
      `);
    } catch (error: unknown) {
      exactLockFailure = error;
    }
    if (postgresErrorField(exactLockFailure, "code") !== "55P03") {
      throw new Error("fresh-clock exact protected row was not holder-locked");
    }
    await waiter.query("BEGIN");
    const waiterPidResult = await waiter.query<{ readonly pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const waiterPid = waiterPidResult.rows[0]?.pid;
    if (waiterPid === undefined) throw new Error("lock waiter PID is absent");
    const actionSample = await observer.query<{
      readonly action_at: Date;
      readonly expires_at: Date;
      readonly pre_expiry: boolean;
      readonly remaining_ms: string;
    }>(`
      WITH sample AS MATERIALIZED (
        SELECT public.hr_wall_clock_ms() AS action_at,expires_at
        FROM hr_scope_epochs
        WHERE id='91000000-0000-0000-0000-000000000005'
      )
      SELECT action_at,expires_at,action_at<expires_at AS pre_expiry,
        (extract(epoch FROM (expires_at-action_at))*1000)::bigint::text
          AS remaining_ms
      FROM sample
    `);
    const sampled = actionSample.rows[0];
    if (
      sampled === undefined
      || !sampled.pre_expiry
      || Number(sampled.remaining_ms) < 5_000
    ) {
      throw new Error(`fresh-clock setup was not pre-expiry: ${JSON.stringify(sampled)}`);
    }
    await waiter.query("SET LOCAL statement_timeout='20s'");
    const pending = waiter.query(`
      SELECT public.hr_assert_reviewed_profile_current(
        profile.id,profile.reviewed_profile_evidence_digest,
        profile.environment_id,profile.environment_mode,
        profile.environment_digest,profile.venue_id,profile.space_id,
        $1::timestamptz
      )
      FROM public.hr_reviewed_profiles AS profile
      WHERE profile.id='91000000-0000-0000-0000-000000000401'
    `, [sampled.action_at]);

    const waitDeadline = Date.now() + 5_000;
    let observedWait = false;
    while (Date.now() < waitDeadline && !observedWait) {
      const state = await observer.query<{
        readonly wait_event_type: string | null;
        readonly blockers: readonly number[];
        readonly non_advisory_wait: boolean;
        readonly advisory_count: string;
      }>(`
        SELECT activity.wait_event_type,
          pg_blocking_pids(activity.pid) AS blockers,
          EXISTS (
            SELECT 1 FROM pg_locks AS lock_row
            WHERE lock_row.pid=activity.pid
              AND lock_row.locktype<>'advisory' AND NOT lock_row.granted
          ) AS non_advisory_wait,
          (SELECT count(*)::text FROM pg_locks AS lock_row
           WHERE lock_row.pid IN ($1,$2)
             AND lock_row.locktype='advisory') AS advisory_count
        FROM pg_stat_activity AS activity
        WHERE activity.pid=$2
      `, [holderPid, waiterPid]);
      const row = state.rows[0];
      observedWait = row?.wait_event_type === "Lock"
        && row.non_advisory_wait
        && row.advisory_count === "0"
        && row.blockers.includes(holderPid);
      if (!observedWait) {
        await new Promise((resolveWait) => {
          setTimeout(resolveWait, 25);
        });
      }
    }
    if (!observedWait) {
      throw new Error("profile currentness wait was not visible in pg_stat_activity/pg_locks");
    }

    const expiryDeadline = Date.now() + 15_000;
    let expired = false;
    while (Date.now() < expiryDeadline && !expired) {
      const state = await observer.query<{ readonly expired: boolean }>(`
        SELECT public.hr_wall_clock_ms() >= expires_at AS expired
        FROM hr_scope_epochs
        WHERE id='91000000-0000-0000-0000-000000000005'
      `);
      expired = state.rows[0]?.expired === true;
      if (!expired) {
        await new Promise((resolveWait) => {
          setTimeout(resolveWait, 25);
        });
      }
    }
    if (!expired) throw new Error("scope epoch did not cross its bounded expiry");
    await holder.query("COMMIT");

    let failure: unknown;
    try {
      await pending;
    } catch (error: unknown) {
      failure = error;
    }
    if (
      postgresErrorField(failure, "code") !== "55000"
      || postgresErrorField(failure, "constraint") !== "hr_scope_epoch_current"
    ) {
      throw new Error(
        `post-wait currentness missed 55000/hr_scope_epoch_current: ${String(failure)}`,
      );
    }
    await waiter.query("ROLLBACK");
  } finally {
    await Promise.allSettled([
      holder.query("ROLLBACK"),
      waiter.query("ROLLBACK"),
      observer.query("ROLLBACK"),
    ]);
    await Promise.allSettled([holder.end(), waiter.end(), observer.end()]);
  }
  assertProfileVector(image, containerName, expiryDatabase, "fresh-clock lock wait");
}

function assertAppendOnly(
  image: ImageConfig,
  containerName: string,
  databaseName: string,
): void {
  const tables = [
    {
      name: "hr_reviewed_profile_subjects",
      predicate: "id='91000000-0000-0000-0000-000000000401'",
    },
    {
      name: "hr_reviewed_profile_actors",
      predicate:
        "reviewed_profile_evidence_id='91000000-0000-0000-0000-000000000401'",
    },
    {
      name: "hr_reviewed_profile_members",
      predicate:
        "reviewed_profile_evidence_id='91000000-0000-0000-0000-000000000401'",
    },
    {
      name: "hr_reviewed_profiles",
      predicate: "id='91000000-0000-0000-0000-000000000401'",
    },
  ] as const;
  for (const table of tables) {
    for (const [operation, sql] of [
      ["UPDATE", `UPDATE ${table.name} SET created_at=created_at WHERE ${table.predicate};`],
      ["DELETE", `DELETE FROM ${table.name} WHERE ${table.predicate};`],
      ["TRUNCATE", `TRUNCATE TABLE ${table.name} CASCADE;`],
    ] as const) {
      assertFailure(
        psql(containerName, databaseName, "postgres", sql),
        `PostgreSQL ${String(image.major)} ${table.name} ${operation}`,
        "55000",
        "hr_evidence_append_only",
      );
    }
  }
}

function runProfilePropagationNegative(
  image: ImageConfig,
  containerName: string,
  databaseName: string,
  label: string,
  mutationSql: string,
  sqlState: string,
  constraint: string,
): void {
  const result = psql(containerName, databaseName, "postgres", `
BEGIN;
${mutationSql}
${profileCurrentnessSql()}
COMMIT;
`);
  assertFailure(result, label, sqlState, constraint);
  assertProfileVector(image, containerName, databaseName, label);
}

async function verifyImage(
  image: ImageConfig,
  migrations: readonly { readonly tag: string; readonly sql: string }[],
  sceneFixture: SceneFixturePhases,
  profileFixture: ProfileFixturePhases,
  catalogSql: string,
): Promise<void> {
  const containerName = `venviewer-hr-0067-pg${String(image.major)}-${runToken}`;
  const templateDatabase = `venviewer_hr_0067_template_${String(image.major)}`;
  const localDatabase = `venviewer_hr_0067_local_${String(image.major)}`;
  const productionDatabase = `venviewer_hr_0067_prod_${String(image.major)}`;
  let verificationError: unknown;
  try {
    requireSuccess(
      runDocker(["pull", image.reference]),
      `PostgreSQL ${String(image.major)} pull`,
    );
    const inspect: unknown = JSON.parse(requireSuccess(
      runDocker(["image", "inspect", image.reference]),
      `PostgreSQL ${String(image.major)} image inspection`,
    ));
    if (
      !Array.isArray(inspect)
      || inspect.length !== 1
      || (inspect[0] as { readonly Id?: unknown }).Id !== image.digest
    ) {
      throw new Error(`PostgreSQL ${String(image.major)} image digest mismatch`);
    }
    requireSuccess(runDocker([
      "run",
      "--detach",
      "--name",
      containerName,
      "--platform",
      postgresPlatform,
      "--publish",
      `127.0.0.1:${String(image.port)}:5432`,
      "--env",
      `POSTGRES_PASSWORD=${postgresPassword}`,
      image.reference,
    ]), `PostgreSQL ${String(image.major)} start`);

    const readyDeadline = Date.now() + 60_000;
    let consecutiveReadyChecks = 0;
    while (Date.now() < readyDeadline && consecutiveReadyChecks < 3) {
      const ready = runDocker([
        "exec",
        containerName,
        "pg_isready",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ]);
      consecutiveReadyChecks = ready.code === 0 ? consecutiveReadyChecks + 1 : 0;
      if (consecutiveReadyChecks === 3) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    const finalReady = runDocker([
      "exec",
      containerName,
      "pg_isready",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ]);
    if (consecutiveReadyChecks !== 3 || finalReady.code !== 0) {
      const state = runDocker([
        "inspect",
        "--format",
        "{{json .State}}",
        containerName,
      ]);
      const logs = runDocker(["logs", "--tail", "200", containerName]);
      throw new Error(
        `PostgreSQL ${String(image.major)} readiness failed\n`
          + `pg_isready: ${finalReady.stderr || finalReady.stdout}\n`
          + `state: ${state.stderr || state.stdout}\n`
          + `logs:\n${logs.stderr}\n${logs.stdout}`,
      );
    }

    const serverVersion = requireSuccess(
      psql(containerName, "postgres", "postgres", "SHOW server_version;"),
      `PostgreSQL ${String(image.major)} version`,
    );
    if (!serverVersion.startsWith(image.expectedVersionPrefix)) {
      throw new Error(`unexpected PostgreSQL version ${serverVersion}`);
    }
    installPlpgsqlCheck(image, containerName);

    requireSuccess(
      psql(containerName, "postgres", "postgres", bootstrapSql(templateDatabase)),
      `PostgreSQL ${String(image.major)} cluster bootstrap`,
    );
    requireSuccess(
      psql(
        containerName,
        templateDatabase,
        "postgres",
        migrationBootstrapSql(),
      ),
      `PostgreSQL ${String(image.major)} migration bootstrap`,
    );

    const target = migrations.at(-1);
    if (target?.tag !== targetMigration) {
      throw new Error("0067 target migration is not the in-memory migration tail");
    }
    const priorMigrations = migrations.slice(0, -1);
    let migrationFailure: unknown;
    try {
      for (const migration of priorMigrations) {
        requireSuccess(
          psql(
            containerName,
            templateDatabase,
            "venviewer_hr_0067_migrator",
            `BEGIN;\n${migration.sql}\nCOMMIT;`,
          ),
          `PostgreSQL ${String(image.major)} migration ${migration.tag}`,
        );
      }
      const baselineBefore = requireSuccess(
        psql(
          containerName,
          templateDatabase,
          "postgres",
          migrationBaselineSql,
        ),
        `PostgreSQL ${String(image.major)} 0066 rollback baseline`,
      );
      requireSuccess(
        psql(
          containerName,
          templateDatabase,
          "venviewer_hr_0067_migrator",
          `BEGIN;\n${target.sql}\nROLLBACK;`,
        ),
        `PostgreSQL ${String(image.major)} 0067 rollback rehearsal`,
      );
      const baselineAfter = requireSuccess(
        psql(
          containerName,
          templateDatabase,
          "postgres",
          migrationBaselineSql,
        ),
        `PostgreSQL ${String(image.major)} 0067 rollback restoration`,
      );
      if (baselineAfter !== baselineBefore) {
        throw new Error(
          `PostgreSQL ${String(image.major)} 0067 rollback changed the 0066 catalog\n`
            + `before=${baselineBefore}\nafter=${baselineAfter}`,
        );
      }
      requireSuccess(
        psql(
          containerName,
          templateDatabase,
          "venviewer_hr_0067_migrator",
          `BEGIN;\n${target.sql}\nCOMMIT;`,
        ),
        `PostgreSQL ${String(image.major)} migration ${target.tag}`,
      );
    } catch (error: unknown) {
      migrationFailure = error;
    } finally {
      requireSuccess(
        psql(
          containerName,
          templateDatabase,
          "postgres",
          externalFinallySql(templateDatabase),
        ),
        `PostgreSQL ${String(image.major)} external finally`,
      );
    }
    if (migrationFailure !== undefined) throw errorFromUnknown(migrationFailure);

    const catalogOutput = requireSuccess(
      psql(
        containerName,
        templateDatabase,
        "postgres",
        catalogSql,
        { migration_login: "venviewer_hr_0067_migrator" },
      ),
      `PostgreSQL ${String(image.major)} 0067 catalog closure`,
    );
    if (!catalogOutput.includes("historical-runtime-reviewed-profile-0067-catalog-ok")) {
      throw new Error(`PostgreSQL ${String(image.major)} catalog marker is absent`);
    }
    assertPlpgsqlCheck(image, containerName, templateDatabase);
    assertLoginBoundaries(image, containerName, templateDatabase);

    requireSuccess(
      psql(containerName, "postgres", "postgres", `
CREATE DATABASE ${localDatabase} TEMPLATE ${templateDatabase}
  OWNER venviewer_hr_0067_owner;
CREATE DATABASE ${productionDatabase} TEMPLATE ${templateDatabase}
  OWNER venviewer_hr_0067_owner;
`),
      `PostgreSQL ${String(image.major)} disposable fixture databases`,
    );

    const localVariables = runSceneUpstream(
      image,
      containerName,
      localDatabase,
      "local",
      sceneFixture,
    );
    assertScopeClockFence(
      image,
      containerName,
      localDatabase,
      "local parser-to-Scene path",
    );
    requireSuccess(
      psql(
        containerName,
        localDatabase,
        "postgres",
        sceneFixture.local,
        localVariables,
      ),
      `PostgreSQL ${String(image.major)} local parser-to-Scene path`,
    );
    assertScopeClockFence(
      image,
      containerName,
      localDatabase,
      "local reviewed-profile path",
    );
    const positiveOutput = requireSuccess(
      psql(
        containerName,
        localDatabase,
        "postgres",
        profileFixture.profilePositive,
        localVariables,
      ),
      `PostgreSQL ${String(image.major)} local reviewed-profile path`,
    );
    if (positiveOutput.split(/\r?\n/u).at(-1) !== "1|17|1|1|1|t") {
      throw new Error(`unexpected local 0067 positive vector: ${positiveOutput}`);
    }
    assertProfileVector(image, containerName, localDatabase, "positive path");
    assertTypedLeafs(image, containerName, localDatabase);
    bodyParity(image, localDatabase);

    const fixtureNegatives = [
      {
        label: "contradictory signed QA record ID",
        sql: profileFixture.contradictoryQa,
        sqlState: "23514",
        constraint: "hr_profile_qa_reviewer_exact",
      },
      {
        label: "contradictory signed QA decision",
        sql: profileFixture.contradictoryQaDecision,
        sqlState: "23514",
        constraint: "hr_profile_qa_reviewer_exact",
      },
      {
        label: "contradictory signed package content digest",
        sql: profileFixture.contradictoryPackage,
        sqlState: "23514",
        constraint: "hr_profile_package_custodian_exact",
      },
      {
        label: "contradictory signed admission ID",
        sql: profileFixture.contradictoryAdmission,
        sqlState: "23514",
        constraint: "hr_admission_reviewer_exact",
      },
      {
        label: "contradictory distinct Scene admission actor",
        sql: profileFixture.contradictorySceneAdmissionActor,
        sqlState: "23514",
        constraint: "hr_profile_scene_admission_actor_exact",
      },
      {
        label: "QA reviewer membership suspension",
        sql: profileFixture.currentnessQaSuspended,
        sqlState: "55000",
        constraint: "hr_authority_snapshot_current",
      },
      {
        label: "package custodian membership suspension",
        sql: profileFixture.currentnessPackageSuspended,
        sqlState: "55000",
        constraint: "hr_authority_snapshot_current",
      },
      {
        label: "Scene reviewer membership suspension",
        sql: profileFixture.currentnessSceneSuspended,
        sqlState: "55000",
        constraint: "hr_authority_snapshot_current",
      },
      {
        label: "profile admission attestation expiry",
        sql: profileFixture.currentnessProfileAdmissionAttestationExpired,
        sqlState: "55000",
        constraint: "hr_role_attestation_current",
      },
      {
        label: "distinct Scene admission attestation expiry",
        sql: profileFixture.currentnessSceneAdmissionAttestationExpired,
        sqlState: "55000",
        constraint: "hr_role_attestation_current",
      },
      {
        label: "final reviewer membership suspension",
        sql: profileFixture.currentnessFinalSuspended,
        sqlState: "55000",
        constraint: "hr_authority_snapshot_current",
      },
    ] as const;
    for (const negative of fixtureNegatives) {
      const result = psql(
        containerName,
        localDatabase,
        "postgres",
        negative.sql,
        localVariables,
      );
      assertFailure(
        result,
        negative.label,
        negative.sqlState,
        negative.constraint,
      );
      assertProfileVector(image, containerName, localDatabase, negative.label);
    }

    for (const [label, membershipId] of [
      ["derivation reviewer propagation", "91000000-0000-0000-0000-000000000040"],
      ["transform reviewer propagation", "91000000-0000-0000-0000-000000000048"],
      ["rights reviewer propagation", "91000000-0000-0000-0000-000000000041"],
    ] as const) {
      runProfilePropagationNegative(
        image,
        containerName,
        localDatabase,
        label,
        `UPDATE workspace_memberships SET status='suspended' WHERE id='${membershipId}';`,
        "55000",
        "hr_authority_snapshot_current",
      );
    }

    runProfilePropagationNegative(
      image,
      containerName,
      localDatabase,
      "private Scene receipt expiry propagation",
      `
ALTER TABLE hr_object_receipts DROP CONSTRAINT hr_object_receipts_shape;
SET LOCAL session_replication_role=replica;
UPDATE hr_object_receipts
SET denial_expires_at=denial_probed_at + interval '1 millisecond'
WHERE id='91000000-0000-0000-0000-000000000631';
SET LOCAL session_replication_role=origin;
`,
      "55000",
      "hr_object_receipt_current",
    );

    runProfilePropagationNegative(
      image,
      containerName,
      localDatabase,
      "normalized profile member deletion",
      `
SET LOCAL session_replication_role=replica;
DELETE FROM hr_reviewed_profile_members
WHERE reviewed_profile_evidence_id='91000000-0000-0000-0000-000000000401';
SET LOCAL session_replication_role=origin;
`,
      "23514",
      "hr_profile_members_complete",
    );
    runProfilePropagationNegative(
      image,
      containerName,
      localDatabase,
      "normalized profile actor deletion",
      `
SET LOCAL session_replication_role=replica;
DELETE FROM hr_reviewed_profile_actors
WHERE reviewed_profile_evidence_id='91000000-0000-0000-0000-000000000401'
  AND actor_role='qa_reviewer';
SET LOCAL session_replication_role=origin;
`,
      "23514",
      "hr_profile_actors_complete",
    );
    runProfilePropagationNegative(
      image,
      containerName,
      localDatabase,
      "profile evidence-record leaf digest swap",
      `
ALTER TABLE hr_evidence_records DROP CONSTRAINT hr_evidence_records_shape;
SET LOCAL session_replication_role=replica;
UPDATE hr_evidence_records SET record_digest=repeat('0',64)
WHERE id='91000000-0000-0000-0000-000000000401';
SET LOCAL session_replication_role=origin;
`,
      "23514",
      "hr_evidence_record_typed_leaf_exact",
    );
    runProfilePropagationNegative(
      image,
      containerName,
      localDatabase,
      "profile transform context swap",
      `
ALTER TABLE hr_reviewed_profile_subjects DROP CONSTRAINT hr_profile_subjects_shape;
SET LOCAL session_replication_role=replica;
UPDATE hr_reviewed_profile_subjects
SET transform_review_id='91000000-0000-0000-0000-000000000710'
WHERE id='91000000-0000-0000-0000-000000000401';
SET LOCAL session_replication_role=origin;
`,
      "23514",
      "hr_profile_subject_exact_body",
    );
    runProfilePropagationNegative(
      image,
      containerName,
      localDatabase,
      "contradictory signed final decision",
      `
ALTER TABLE hr_role_attestations DROP CONSTRAINT hr_role_attestations_shape;
SET LOCAL session_replication_role=replica;
UPDATE hr_role_attestations
SET attestation_body=jsonb_set(
  attestation_body,'{subject,evidence,decision}','"rejected"'::jsonb
)
WHERE id='91000000-0000-0000-0000-000000000738';
SET LOCAL session_replication_role=origin;
`,
      "23514",
      "hr_profile_final_reviewer_exact",
    );

    assertAppendOnly(image, containerName, localDatabase);
    await assertAdmissionLockOrder(image, localDatabase);
    assertProfileVector(image, containerName, localDatabase, "all negatives");
    await assertFreshClockAfterObservedLockWait(
      image,
      containerName,
      localDatabase,
    );

    const productionVariables = runSceneUpstream(
      image,
      containerName,
      productionDatabase,
      "production",
      sceneFixture,
    );
    assertScopeClockFence(
      image,
      containerName,
      productionDatabase,
      "production runtime identity gate",
    );
    const productionGate = psql(
      containerName,
      productionDatabase,
      "postgres",
      sceneFixture.production,
      productionVariables,
    );
    assertFailure(
      productionGate,
      "production runtime identity gate",
      "55000",
      "hr_scene_parser_runtime_identity_current",
    );
    const productionCounts = requireSuccess(
      psql(containerName, productionDatabase, "postgres", `
SELECT concat_ws('|',
  (SELECT count(*) FROM hr_verified_twin_release_authorities),
  (SELECT count(*) FROM hr_scene_parser_runtime_identities),
  (SELECT count(*) FROM hr_scene_parser_runtime_identity_revocations),
  (SELECT count(*) FROM hr_scene_map_parser_receipts),
  (SELECT count(*) FROM hr_verified_scene_map_receipts),
  (SELECT count(*) FROM hr_scene_validation_subjects),
  (SELECT count(*) FROM hr_scene_whole_regions),
  (SELECT count(*) FROM hr_scene_validation_members),
  (SELECT count(*) FROM hr_scene_member_regions),
  (SELECT count(*) FROM hr_scene_validations),
  (SELECT count(*) FROM hr_reviewed_profile_subjects),
  (SELECT count(*) FROM hr_reviewed_profile_actors),
  (SELECT count(*) FROM hr_reviewed_profile_members),
  (SELECT count(*) FROM hr_reviewed_profiles)
);
`),
      `PostgreSQL ${String(image.major)} production zero-row gate`,
    ).split(/\r?\n/u).at(-1);
    if (productionCounts !== "1|0|0|0|0|0|0|0|0|0|0|0|0|0") {
      throw new Error(`unexpected production fail-closed counts: ${String(productionCounts)}`);
    }

    process.stdout.write(
      `PostgreSQL ${String(image.major)} ${serverVersion}: 0066-to-0067 rollback `
        + "restoration, plpgsql_check 13 contexts, 0067 catalog, local profile "
        + "E2E, strict body parity, signed/deep/graph/append-only negatives, "
        + "DB-observed protected-row two-way lock order, post-lock fresh-clock "
        + "currentness, "
        + "and production fail-closed gate passed\n",
    );
  } catch (error: unknown) {
    verificationError = error;
  }
  const cleanup = runDocker(["rm", "-f", containerName]);
  const cleanupOutput = `${cleanup.stderr}\n${cleanup.stdout}`;
  if (cleanup.code !== 0 && !cleanupOutput.includes("No such container")) {
    const cleanupError = new Error(
      `PostgreSQL ${String(image.major)} disposable cleanup failed\n${cleanupOutput}`,
    );
    verificationError = verificationError === undefined
      ? cleanupError
      : new AggregateError(
        [errorFromUnknown(verificationError), cleanupError],
        `PostgreSQL ${String(image.major)} verification and cleanup failed`,
      );
  }
  if (verificationError !== undefined) throw errorFromUnknown(verificationError);
}

async function main(): Promise<void> {
  requireLocalDockerDaemon();
  const [migrations, sceneSql, profileSql, catalogSql] = await Promise.all([
    loadMigrations(),
    readFile(sceneFixturePath, "utf8"),
    readFile(profileFixturePath, "utf8"),
    readFile(catalogFixturePath, "utf8"),
  ]);
  const sceneFixture = splitSceneFixture(sceneSql);
  const profileFixture = splitProfileFixture(profileSql);
  for (const image of images) {
    await verifyImage(image, migrations, sceneFixture, profileFixture, catalogSql);
  }
  process.stdout.write("HISTORICAL_RUNTIME_REVIEWED_PROFILE_0067_POSTGRES_OK\n");
}

await main();
