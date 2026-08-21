import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHistoricalRuntimeScene0066Material } from
  "../__tests__/fixtures/historical-runtime-scene-0066-material.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptDirectory, "../..");
const workspaceDirectory = resolve(apiDirectory, "../..");
const migrationDirectory = join(apiDirectory, "drizzle");
const behaviorFixturePath = resolve(
  scriptDirectory,
  "../__tests__/fixtures/historical-runtime-scene-0066-behavior.sql",
);
const catalogFixturePath = resolve(
  scriptDirectory,
  "../__tests__/fixtures/historical-runtime-scene-0066-catalog.sql",
);
const journalPath = join(migrationDirectory, "meta", "_journal.json");
const targetMigration = "0066_historical_runtime_verified_scene";
const postgresPlatform = "linux/amd64";

const images = Object.freeze([
  {
    major: 16,
    port: 55429,
    reference:
      "postgres:16@sha256:eb4759788a2182f08257135e61a34f2cfc3c2914079f3465d64ee62350f4d081",
    digest:
      "sha256:eb4759788a2182f08257135e61a34f2cfc3c2914079f3465d64ee62350f4d081",
    expectedVersionPrefix: "16.14",
  },
  {
    major: 17,
    port: 55439,
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

interface FixturePhases {
  readonly upstream: string;
  readonly upstreamAfterScope: string;
  readonly sceneCommon: string;
  readonly local: string;
  readonly production: string;
  readonly negativeSeed: string;
}

interface ImageConfig {
  readonly major: 16 | 17;
  readonly port: 55429 | 55439;
  readonly reference: string;
  readonly digest: string;
  readonly expectedVersionPrefix: string;
}

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
    maxBuffer: 64 * 1024 * 1024,
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
  if (result.code === 0) {
    throw new Error(`${label} unexpectedly succeeded`);
  }
  const output = `${result.stderr}\n${result.stdout}`;
  if (!output.includes(sqlState) || !output.includes(constraint)) {
    throw new Error(
      `${label} missed ${sqlState}/${constraint}\n${output}`,
    );
  }
}

function errorFromUnknown(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function splitFixture(sql: string): FixturePhases {
  const matches = [...sql.matchAll(/^-- @phase ([a-z-]+)\r?$/gmu)];
  const sections = new Map<string, string>();
  for (const [index, match] of matches.entries()) {
    const name = match[1];
    if (name === undefined) continue;
    if (sections.has(name)) {
      throw new Error(`0066 behavior fixture repeats phase ${name}`);
    }
    const next = matches[index + 1];
    const start = match.index + match[0].length;
    const end = next?.index ?? sql.length;
    sections.set(name, sql.slice(start, end).trim());
  }
  const expectedPhases = [
    "upstream",
    "upstream-after-scope",
    "scene-common",
    "local",
    "production",
    "negative-seed",
  ] as const;
  const actualPhases = [...sections.keys()];
  if (
    actualPhases.length !== expectedPhases.length
    || actualPhases.some((phase, index) => phase !== expectedPhases[index])
  ) {
    throw new Error(
      `0066 behavior fixture phases drifted: ${actualPhases.join(",")}`,
    );
  }
  const requirePhase = (name: string): string => {
    const value = sections.get(name);
    if (value === undefined || value.length === 0) {
      throw new Error(`0066 behavior fixture is missing phase ${name}`);
    }
    return value;
  };
  return {
    upstream: requirePhase("upstream"),
    upstreamAfterScope: requirePhase("upstream-after-scope"),
    sceneCommon: requirePhase("scene-common"),
    local: requirePhase("local"),
    production: requirePhase("production"),
    negativeSeed: requirePhase("negative-seed"),
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
SELECT public.fixture_wait_for_db_clock(
  scope.effective_at,
  :'clock_fence_label'
)
FROM public.hr_scope_epochs AS scope
WHERE scope.id='91000000-0000-0000-0000-000000000005';
WITH sample AS MATERIALIZED (
  SELECT public.hr_wall_clock_ms() AS observed_at,scope.effective_at
  FROM public.hr_scope_epochs AS scope
  WHERE scope.id='91000000-0000-0000-0000-000000000005'
)
SELECT concat_ws('|',
  observed_at >= effective_at,
  public.hr_iso_utc_ms(observed_at),
  public.hr_iso_utc_ms(effective_at)
)
FROM sample;
`, { clock_fence_label: label }),
    `PostgreSQL ${String(image.major)} ${label} DB-clock fence`,
  );
  const observation = output.split(/\r?\n/u).at(-1);
  if (observation?.split("|")[0] !== "t") {
    throw new Error(
      `PostgreSQL ${String(image.major)} ${label} DB-clock fence regressed: `
        + String(observation),
    );
  }
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
  const migrations = await Promise.all(journal.entries.map(async (entry) => {
    const bytes = await readFile(join(migrationDirectory, `${entry.tag}.sql`));
    return { tag: entry.tag, sql: bytes.toString("utf8") };
  }));
  const targetIndex = migrations.findIndex((migration) =>
    migration.tag === targetMigration
  );
  if (targetIndex < 0 || targetIndex !== migrations.length - 1) {
    throw new Error("0066 must be the exact journal tail for this verifier");
  }
  const targetBytes = await readFile(join(migrationDirectory, `${targetMigration}.sql`));
  const targetSha256 = createHash("sha256").update(targetBytes).digest("hex");
  if (
    targetBytes.byteLength !== 405_109
    || targetSha256 !==
      "1a33375f9197950568ac9a182600efa8e5154b11b93029c6d15abbb077357671"
  ) {
    throw new Error(
      `0066 bytes drifted: ${targetSha256}/${String(targetBytes.byteLength)}`,
    );
  }
  return migrations;
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
CREATE ROLE venviewer_hr_0066_owner NOLOGIN NOINHERIT;
CREATE ROLE venviewer_hr_0066_migrator LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE venviewer_local_fixture_verifier LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE venviewer_prod_fixture_verifier LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE venviewer_prod_fixture_gateway LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE venviewer_prod_fixture_api LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE venviewer_bad_verifier_super LOGIN NOINHERIT SUPERUSER;
CREATE ROLE venviewer_bad_verifier_reader LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT omnitwin_historical_evidence_verifier
  TO venviewer_local_fixture_verifier WITH INHERIT FALSE, SET TRUE;
GRANT omnitwin_historical_evidence_verifier
  TO venviewer_prod_fixture_verifier WITH INHERIT FALSE, SET TRUE;
GRANT omnitwin_historical_auth_gateway
  TO venviewer_prod_fixture_gateway WITH INHERIT FALSE, SET TRUE;
GRANT omnitwin_api_activation
  TO venviewer_prod_fixture_api WITH INHERIT FALSE, SET TRUE;
GRANT omnitwin_historical_evidence_verifier
  TO venviewer_bad_verifier_super WITH INHERIT FALSE, SET TRUE;
GRANT omnitwin_historical_evidence_verifier,pg_read_all_data
  TO venviewer_bad_verifier_reader WITH INHERIT FALSE, SET TRUE;
CREATE DATABASE ${databaseName} OWNER venviewer_hr_0066_owner;
GRANT CONNECT,TEMPORARY,CREATE ON DATABASE ${databaseName}
  TO venviewer_hr_0066_migrator;
`;
}

function migrationBootstrapSql(): string {
  return `
GRANT USAGE,CREATE ON SCHEMA public
  TO venviewer_hr_0066_migrator WITH GRANT OPTION;
GRANT omnitwin_historical_schema_owner
  TO venviewer_hr_0066_migrator WITH INHERIT FALSE, SET TRUE;
GRANT omnitwin_historical_evidence_owner
  TO venviewer_hr_0066_migrator WITH INHERIT FALSE, SET TRUE;
`;
}

function externalFinallySql(databaseName: string): string {
  return `
REVOKE omnitwin_historical_schema_owner FROM venviewer_hr_0066_migrator;
REVOKE omnitwin_historical_evidence_owner FROM venviewer_hr_0066_migrator;
REVOKE USAGE,CREATE ON SCHEMA public
  FROM venviewer_hr_0066_migrator CASCADE;
REVOKE CREATE,TEMPORARY ON DATABASE ${databaseName}
  FROM venviewer_hr_0066_migrator;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename='venviewer_hr_0066_migrator' AND pid<>pg_backend_pid();
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

function bodyParity(
  image: ImageConfig,
  databaseName: string,
): void {
  const url = `postgresql://postgres:${postgresPassword}@127.0.0.1:${String(image.port)}/${databaseName}`;
  const result = runCommand(process.execPath, [
    join(apiDirectory, "node_modules", "vitest", "vitest.mjs"),
    "run",
    "src/__tests__/historical-runtime-scene-body-parity.test.ts",
  ], {
    cwd: apiDirectory,
    environment: {
      ...process.env,
      HISTORICAL_RUNTIME_SCENE_DATABASE_URL: url,
      RUN_HISTORICAL_RUNTIME_SCENE_POSTGRES: "1",
    },
  });
  requireSuccess(result, `PostgreSQL ${String(image.major)} strict body parity`);
  if (!result.stdout.includes("1 passed")) {
    throw new Error(
      `PostgreSQL ${String(image.major)} body parity did not prove one non-skipped test`,
    );
  }
}

async function verifyImage(
  image: ImageConfig,
  migrations: readonly { readonly tag: string; readonly sql: string }[],
  fixture: FixturePhases,
  catalogSql: string,
): Promise<void> {
  const containerName = `venviewer-hr-0066-pg${String(image.major)}-${runToken}`;
  const templateDatabase = `venviewer_hr_0066_template_${String(image.major)}`;
  const localDatabase = `venviewer_hr_0066_local_${String(image.major)}`;
  const productionDatabase = `venviewer_hr_0066_prod_${String(image.major)}`;
  let verificationError: unknown;
  try {
    requireSuccess(runDocker(["pull", image.reference]), `PostgreSQL ${String(image.major)} pull`);
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

    requireSuccess(
      psql(
        containerName,
        "postgres",
        "postgres",
        bootstrapSql(templateDatabase),
      ),
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

    let migrationFailure: unknown;
    try {
      for (const migration of migrations) {
        const result = psql(
          containerName,
          templateDatabase,
          "venviewer_hr_0066_migrator",
          `BEGIN;\n${migration.sql}\nCOMMIT;`,
        );
        requireSuccess(
          result,
          `PostgreSQL ${String(image.major)} migration ${migration.tag}`,
        );
      }
    } catch (error: unknown) {
      migrationFailure = error;
    } finally {
      const cleanup = psql(
        containerName,
        templateDatabase,
        "postgres",
        externalFinallySql(templateDatabase),
      );
      requireSuccess(cleanup, `PostgreSQL ${String(image.major)} external finally`);
    }
    if (migrationFailure !== undefined) throw errorFromUnknown(migrationFailure);

    const catalogOutput = requireSuccess(
      psql(
        containerName,
        templateDatabase,
        "postgres",
        catalogSql,
        { migration_login: "venviewer_hr_0066_migrator" },
      ),
      `PostgreSQL ${String(image.major)} catalog closure`,
    );
    if (!catalogOutput.includes("historical-runtime-scene-0066-catalog-ok")) {
      throw new Error(`PostgreSQL ${String(image.major)} catalog marker is absent`);
    }

    for (const [login, capability] of [
      ["venviewer_prod_fixture_gateway", "omnitwin_historical_auth_gateway"],
      ["venviewer_prod_fixture_api", "omnitwin_api_activation"],
      ["venviewer_prod_fixture_verifier", "omnitwin_historical_evidence_verifier"],
    ] as const) {
      const identity = requireSuccess(
        psql(containerName, templateDatabase, login, `
SELECT concat_ws('|',session_user,current_user,
  session_user=current_user,
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
      "venviewer_bad_verifier_super",
      "venviewer_bad_verifier_reader",
    ] as const) {
      const result = psql(containerName, templateDatabase, login, `
SET ROLE omnitwin_historical_evidence_verifier;
INSERT INTO hr_scene_map_parser_receipts DEFAULT VALUES;
`);
      assertFailure(
        result,
        `${login} verifier isolation`,
        "42501",
        "hr_trusted_evidence_verifier_isolation",
      );
    }

    requireSuccess(
      psql(containerName, "postgres", "postgres", `
CREATE DATABASE ${localDatabase} TEMPLATE ${templateDatabase}
  OWNER venviewer_hr_0066_owner;
CREATE DATABASE ${productionDatabase} TEMPLATE ${templateDatabase}
  OWNER venviewer_hr_0066_owner;
`),
      `PostgreSQL ${String(image.major)} disposable fixture databases`,
    );

    const runUpstream = (databaseName: string, profile: "local" | "production") => {
      const variables = fixtureVariables(databaseName, profile);
      requireSuccess(
        psql(
          containerName,
          databaseName,
          "postgres",
          fixture.upstream,
          variables,
        ),
        `PostgreSQL ${String(image.major)} ${profile} upstream fixture`,
      );
      assertScopeClockFence(
        image,
        containerName,
        databaseName,
        `${profile} post-scope`,
      );
      requireSuccess(
        psql(
          containerName,
          databaseName,
          "postgres",
          fixture.upstreamAfterScope,
          variables,
        ),
        `PostgreSQL ${String(image.major)} ${profile} post-scope upstream fixture`,
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
      const materialVariables = {
        ...variables,
        ...material.psqlVariables,
      };
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
    };

    const localVariables = runUpstream(localDatabase, "local");
    assertScopeClockFence(
      image,
      containerName,
      localDatabase,
      "local parser-to-Scene path",
    );
    requireSuccess(
      psql(containerName, localDatabase, "postgres", fixture.local, localVariables),
      `PostgreSQL ${String(image.major)} local parser-to-Scene path`,
    );
    const localCounts = requireSuccess(
      psql(containerName, localDatabase, "postgres", `
SELECT concat_ws('|',
  (SELECT count(*) FROM hr_scene_parser_runtime_identities),
  (SELECT count(*) FROM hr_scene_map_parser_receipts),
  (SELECT count(*) FROM hr_verified_scene_map_receipts),
  (SELECT count(*) FROM hr_scene_validation_subjects),
  (SELECT count(*) FROM hr_scene_validations),
  (SELECT count(*) FROM hr_scene_whole_regions),
  (SELECT count(*) FROM hr_scene_validation_members),
  (SELECT count(*) FROM hr_scene_member_regions)
);
`),
      `PostgreSQL ${String(image.major)} local row counts`,
    );
    if (localCounts.split(/\r?\n/u).at(-1) !== "0|1|1|1|1|1|1|1") {
      throw new Error(`unexpected local 0066 counts: ${localCounts}`);
    }
    bodyParity(image, localDatabase);

    assertScopeClockFence(
      image,
      containerName,
      localDatabase,
      "negative fixture seed",
    );
    requireSuccess(
      psql(
        containerName,
        localDatabase,
        "postgres",
        fixture.negativeSeed,
        localVariables,
      ),
      `PostgreSQL ${String(image.major)} negative fixture seed`,
    );
    const parserId = "91000000-0000-0000-0000-000000000660";
    const parserStartMarker = "-- @fixture local-parser-insert-start";
    const parserEndMarker = "-- @fixture local-parser-insert-end";
    const parserStart = fixture.local.indexOf(parserStartMarker);
    const parserEnd = fixture.local.indexOf(parserEndMarker);
    if (parserStart < 0 || parserEnd <= parserStart) {
      throw new Error("local fixture parser insert section is absent");
    }
    const parserInsert = fixture.local.slice(
      parserStart + parserStartMarker.length,
      parserEnd,
    );
    const negativeCases = [
      {
        label: "parsed-map digest mismatch",
        constraint: "hr_scene_map_parser_digest",
        sql: parserInsert
          .replaceAll(parserId, "91000000-0000-0000-0000-000000000670"),
        variables: { ...localVariables, parsed_map_digest: "0".repeat(64) },
      },
      {
        label: "release receipt wrong role",
        constraint: "P0002",
        sql: parserInsert
          .replaceAll(parserId, "91000000-0000-0000-0000-000000000671")
          .replaceAll("91000000-0000-0000-0000-000000000632",
            "91000000-0000-0000-0000-000000000682"),
        variables: localVariables,
      },
      {
        label: "source receipt wrong role",
        constraint: "P0002",
        sql: parserInsert
          .replaceAll(parserId, "91000000-0000-0000-0000-000000000672")
          .replaceAll("91000000-0000-0000-0000-000000000633",
            "91000000-0000-0000-0000-000000000683"),
        variables: localVariables,
      },
      {
        label: "mixed local provider",
        constraint: "hr_scene_map_parser_local_objects",
        sql: parserInsert
          .replaceAll(parserId, "91000000-0000-0000-0000-000000000673")
          .replaceAll("91000000-0000-0000-0000-000000000632",
            "91000000-0000-0000-0000-000000000684"),
        variables: localVariables,
      },
    ] as const;
    for (const negative of negativeCases) {
      const result = psql(
        containerName,
        localDatabase,
        "postgres",
        negative.sql,
        negative.variables,
      );
      if (negative.constraint === "P0002") {
        if (result.code === 0 || !`${result.stderr}\n${result.stdout}`.includes("P0002")) {
          throw new Error(`${negative.label} did not fail closed\n${result.stderr}`);
        }
      } else {
        assertFailure(result, negative.label, "23514", negative.constraint);
      }
    }
    const parserCountAfterNegatives = requireSuccess(
      psql(containerName, localDatabase, "postgres",
        "SELECT count(*) FROM hr_scene_map_parser_receipts;"),
      `PostgreSQL ${String(image.major)} parser rollback count`,
    ).split(/\r?\n/u).at(-1);
    if (parserCountAfterNegatives !== "1") {
      throw new Error("negative parser attempts changed durable row count");
    }

    const transformSuspension = psql(containerName, localDatabase, "postgres", `
BEGIN;
UPDATE workspace_memberships SET status='suspended',updated_at=clock_timestamp()
WHERE id='91000000-0000-0000-0000-000000000045';
SET LOCAL ROLE omnitwin_historical_evidence_owner;
SELECT hr_assert_verified_scene_map_receipt_current(
  handle.id,subject.environment_id,subject.environment_mode,
  subject.environment_digest,subject.venue_id,subject.space_id,
  hr_wall_clock_ms()
)
FROM hr_verified_scene_map_receipts AS handle
JOIN hr_scene_validation_subjects AS subject
  ON subject.scene_map_verification_receipt_id=handle.id;
COMMIT;
`);
    assertFailure(
      transformSuspension,
      "transform reviewer suspension currentness",
      "55000",
      "hr_authority_snapshot_current",
    );
    const transformRollback = requireSuccess(
      psql(containerName, localDatabase, "postgres", `
SELECT concat_ws('|',
  (SELECT status FROM workspace_memberships
   WHERE id='91000000-0000-0000-0000-000000000045'),
  (SELECT count(*) FROM hr_scene_map_parser_receipts),
  (SELECT count(*) FROM hr_verified_scene_map_receipts),
  (SELECT count(*) FROM hr_scene_validation_subjects),
  (SELECT count(*) FROM hr_scene_validations)
);
`),
      `PostgreSQL ${String(image.major)} transform rollback proof`,
    ).split(/\r?\n/u).at(-1);
    if (transformRollback !== "active|1|1|1|1") {
      throw new Error(
        `transform-currentness failure did not roll back: ${String(transformRollback)}`,
      );
    }
    const sealedMember = psql(containerName, localDatabase, "postgres", `
BEGIN;
INSERT INTO runtime_presentation_admission_members(admission_id,member_index)
VALUES ('91000000-0000-0000-0000-000000000705',1);
COMMIT;
`);
    assertFailure(
      sealedMember,
      "admission member seal",
      "55000",
      "hr_scene_map_receipt_admission_members_sealed",
    );
    const sealRollback = requireSuccess(
      psql(containerName, localDatabase, "postgres", `
SELECT concat_ws('|',
  (SELECT count(*) FROM runtime_presentation_admission_members
   WHERE admission_id='91000000-0000-0000-0000-000000000705'),
  (SELECT min(member_index) FROM runtime_presentation_admission_members
   WHERE admission_id='91000000-0000-0000-0000-000000000705'),
  (SELECT max(member_index) FROM runtime_presentation_admission_members
   WHERE admission_id='91000000-0000-0000-0000-000000000705'),
  (SELECT count(*) FROM hr_scene_map_parser_receipts),
  (SELECT count(*) FROM hr_verified_scene_map_receipts),
  (SELECT count(*) FROM hr_scene_validation_subjects),
  (SELECT count(*) FROM hr_scene_validations)
);
`),
      `PostgreSQL ${String(image.major)} admission seal rollback proof`,
    ).split(/\r?\n/u).at(-1);
    if (sealRollback !== "1|0|0|1|1|1|1") {
      throw new Error(
        `admission-member failure did not roll back: ${String(sealRollback)}`,
      );
    }

    const productionVariables = runUpstream(productionDatabase, "production");
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
      fixture.production,
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
  (SELECT count(*) FROM hr_scene_validations)
);
`),
      `PostgreSQL ${String(image.major)} production zero-row gate`,
    ).split(/\r?\n/u).at(-1);
    if (productionCounts !== "1|0|0|0|0|0|0|0|0|0") {
      throw new Error(
        `unexpected production fail-closed counts: ${String(productionCounts)}`,
      );
    }

    process.stdout.write(
      `PostgreSQL ${String(image.major)} ${serverVersion}: catalog, local E2E, `
        + "four-body parity, negatives, and production fail-closed gate passed\n",
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
  const [migrations, behaviorSql, catalogSql] = await Promise.all([
    loadMigrations(),
    readFile(behaviorFixturePath, "utf8"),
    readFile(catalogFixturePath, "utf8"),
  ]);
  const fixture = splitFixture(behaviorSql);
  for (const image of images) {
    await verifyImage(image, migrations, fixture, catalogSql);
  }
  process.stdout.write("HISTORICAL_RUNTIME_SCENE_0066_POSTGRES_OK\n");
}

await main();
