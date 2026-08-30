import { spawn } from "node:child_process";

import { asError } from "@omnitwin/reconstruction-foundry";

import { GRAND_HALL_DIFIX_EXPLICIT_RUN_OPT_IN } from "./grand-hall-difix-one-shot-contract.js";
import {
  checkGrandHallDifixExecutionLock,
  compileGrandHallDifixAuthorizationFromSpec,
  compileGrandHallDifixExecutionLockFromSpec,
  grandHallDifixStablePythonScriptArguments,
  readGrandHallDifixOneShotSpec,
  runGrandHallDifixOneShot,
} from "./grand-hall-difix-one-shot.js";

const USAGE = `Grand Hall Difix bounded local one-shot lane

Dry compilation (never dispatches):
  pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- compile --spec <absolute-json>

Dry validation (default hashes bound files; --exhaustive also rehashes sealed trees in no-network WSL):
  pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- check --lock <absolute-json> [--exhaustive]

Create a separate short-lived one-attempt authorization overlay (never dispatches):
  pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- authorize --spec <absolute-json>

Explicit expensive seal/check operations (never dispatch provider inference):
  pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- seal-runtime --distribution <name> --python-wsl /usr/bin/python3 --seal-tool-wsl <path> --seal-tool-sha256 <sha256:...> --seal-tool-size-bytes <n> -- <seal-tool args>
  pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- seal-model --distribution <name> --python-wsl /usr/bin/python3 --seal-tool-wsl <path> --seal-tool-sha256 <sha256:...> --seal-tool-size-bytes <n> -- <seal-tool args>
  pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- check-seal --distribution <name> --python-wsl /usr/bin/python3 --seal-tool-wsl <path> --seal-tool-sha256 <sha256:...> --seal-tool-size-bytes <n> -- <seal-tool args>

Consume exactly one authorization and run once:
  pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-difix-one-shot -- run --lock <absolute-json> --authorization <absolute-json> --opt-in "${GRAND_HALL_DIFIX_EXPLICIT_RUN_OPT_IN}"
`;

function valueAfter(args: readonly string[], flag: string): string {
  const positions = args.flatMap((value, index) => value === flag ? [index] : []);
  if (positions.length !== 1) throw new Error(`${flag} must appear exactly once.`);
  const value = args[(positions[0] ?? -1) + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function ensureOnly(args: readonly string[], allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === undefined) continue;
    if (!value.startsWith("--")) continue;
    if (!allowedSet.has(value)) throw new Error(`Unknown argument ${value}.`);
    if (value !== "--exhaustive") index += 1;
  }
}

function sanitizedHostEnvironment(): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = { WSL_UTF8: "1" };
  for (const key of ["SystemRoot", "WINDIR", "PATH"] as const) {
    const value = process.env[key];
    if (value !== undefined) output[key] = value;
  }
  return output;
}

async function runSealTool(args: readonly string[], command: "seal-runtime" | "seal-model" | "check-seal"): Promise<void> {
  const separator = args.indexOf("--");
  if (separator < 0) throw new Error(`${command} requires -- before the seal-tool arguments.`);
  const control = args.slice(0, separator);
  ensureOnly(control, ["--distribution", "--python-wsl", "--seal-tool-wsl", "--seal-tool-sha256", "--seal-tool-size-bytes"]);
  const distribution = valueAfter(control, "--distribution");
  const python = valueAfter(control, "--python-wsl");
  const script = valueAfter(control, "--seal-tool-wsl");
  const scriptSha256 = valueAfter(control, "--seal-tool-sha256");
  const scriptSizeBytes = Number(valueAfter(control, "--seal-tool-size-bytes"));
  if (python !== "/usr/bin/python3") throw new Error(`${command} requires the pinned /usr/bin/python3 verifier.`);
  const forwarded = args.slice(separator + 1);
  if (forwarded.length === 0) throw new Error(`${command} requires explicit seal-tool arguments.`);
  const expectedSubcommand = command === "seal-runtime"
    ? "seal-runtime"
    : command === "seal-model"
      ? "seal-model"
      : null;
  if (expectedSubcommand !== null && forwarded[0] !== expectedSubcommand) {
    throw new Error(`${command} requires ${expectedSubcommand} as the first forwarded argument.`);
  }
  if (command === "check-seal" && forwarded[0] !== "check-runtime" && forwarded[0] !== "check-model") {
    throw new Error("check-seal permits only check-runtime or check-model.");
  }
  const exitCode = await new Promise<number>((resolvePromise, rejectPromise) => {
    const child = spawn("wsl.exe", [
      "--distribution", distribution,
      "--exec",
      "unshare", "--user", "--map-root-user", "--net",
      "env", "-i",
      "HF_HUB_OFFLINE=1",
      "TRANSFORMERS_OFFLINE=1",
      "DIFFUSERS_OFFLINE=1",
      "HF_DATASETS_OFFLINE=1",
      "HF_HUB_DISABLE_IMPLICIT_TOKEN=1",
      "HF_HUB_DISABLE_TELEMETRY=1",
      "PIP_NO_INDEX=1",
      "CUBLAS_WORKSPACE_CONFIG=:4096:8",
      "PYTHONDONTWRITEBYTECODE=1",
      "PYTHONNOUSERSITE=1",
      "PATH=/usr/local/cuda/bin:/usr/bin:/bin",
      "HOME=/tmp",
      ...grandHallDifixStablePythonScriptArguments({
        pythonWsl: python,
        scriptWsl: script,
        scriptSha256,
        scriptSizeBytes,
        noSite: true,
        scriptArguments: forwarded,
      }),
    ], {
      shell: false,
      windowsHide: true,
      env: sanitizedHostEnvironment(),
      stdio: "inherit",
    });
    child.once("error", rejectPromise);
    child.once("close", (code) => { resolvePromise(code ?? 1); });
  });
  if (exitCode !== 0) throw new Error(`${command} stopped with exit code ${String(exitCode)}.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const [command, ...rest] = args;
  if (command === "compile") {
    ensureOnly(rest, ["--spec"]);
    const result = await compileGrandHallDifixExecutionLockFromSpec(
      await readGrandHallDifixOneShotSpec(valueAfter(rest, "--spec")),
    );
    process.stdout.write(`${JSON.stringify({
      state: "compiled_not_authorized_not_dispatched",
      executionLockSha256: result.executionLockSha256,
      executionLockHost: result.paths.executionLockHost,
    }, null, 2)}\n`);
    return;
  }
  if (command === "authorize") {
    ensureOnly(rest, ["--spec"]);
    const result = await compileGrandHallDifixAuthorizationFromSpec(
      await readGrandHallDifixOneShotSpec(valueAfter(rest, "--spec")),
    );
    process.stdout.write(`${JSON.stringify({
      state: "authorization_overlay_compiled_not_dispatched",
      authorizationSha256: result.authorizationSha256,
      expiresAt: result.expiresAt,
      maximumAttempts: result.maximumAttempts,
    }, null, 2)}\n`);
    return;
  }
  if (command === "check") {
    ensureOnly(rest, ["--lock", "--exhaustive"]);
    const result = await checkGrandHallDifixExecutionLock(
      valueAfter(rest, "--lock"),
      rest.includes("--exhaustive"),
    );
    process.stdout.write(`${JSON.stringify({
      state: rest.includes("--exhaustive") ? "checked_exhaustive_zero_write" : "checked_bound_files_zero_write",
      executionLockSha256: result.lock.executionLockSha256,
      materialSetSha256: result.materialSetSha256,
      baseExperimentExecution: "not_authorized",
    }, null, 2)}\n`);
    return;
  }
  if (command === "seal-runtime" || command === "seal-model" || command === "check-seal") {
    await runSealTool(rest, command);
    return;
  }
  if (command === "run") {
    ensureOnly(rest, ["--lock", "--authorization", "--opt-in"]);
    const result = await runGrandHallDifixOneShot({
      lockHostPath: valueAfter(rest, "--lock"),
      authorizationHostPath: valueAfter(rest, "--authorization"),
      explicitOptIn: valueAfter(rest, "--opt-in"),
    });
    process.stdout.write(`${JSON.stringify({
      state: result.phase,
      attemptReceiptSha256: result.attemptReceiptSha256,
      retryPermitted: false,
      capturedAuthority: result.authority.captured,
      structuralAuthority: result.authority.structural,
      runtimeAuthority: result.authority.runtime,
    }, null, 2)}\n`);
    if (result.phase !== "succeeded") process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown command ${String(command)}.`);
}

try {
  await main();
} catch (error: unknown) {
  process.stderr.write(`Grand Hall Difix one-shot lane stopped safely: ${asError(error).message}\n`);
  process.exitCode = 1;
}
