import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { inspectCapture } from "./inventory.js";
import {
  assertDisjointDestination,
  canonicalSourceRoot,
} from "./path-safety.js";
import { stageCapture, writeImmutableJson } from "./stage.js";

const CLI_OPTIONS = {
  source: { type: "string" },
  staging: { type: "string" },
  report: { type: "string" },
  "hash-all": { type: "boolean", default: false },
} as const;

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") throw new Error(`--${name} is required`);
  return value;
}

function rejectOption(name: string, value: string | undefined): void {
  if (value !== undefined) throw new Error(`--${name} is not valid for this command`);
}

async function runInspect(values: {
  source?: string;
  staging?: string;
  report?: string;
  "hash-all"?: boolean;
}): Promise<void> {
  rejectOption("staging", values.staging);
  const source = required("source", values.source);
  const inspection = await inspectCapture(source, { hashAll: values["hash-all"] ?? false });
  if (values.report === undefined) {
    process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
    return;
  }
  const sourceRoot = await canonicalSourceRoot(source);
  const report = await assertDisjointDestination(sourceRoot, resolve(values.report));
  await writeImmutableJson(report, inspection);
  process.stdout.write(`inspection written: ${report}\n`);
}

async function runStage(values: {
  source?: string;
  staging?: string;
  report?: string;
  "hash-all"?: boolean;
}): Promise<void> {
  rejectOption("report", values.report);
  if (values["hash-all"] === true) throw new Error("--hash-all is only valid for inspect");
  const result = await stageCapture(
    required("source", values.source),
    required("staging", values.staging),
  );
  process.stdout.write(
    `stage complete: ${String(result.manifest.fileCount)} files, ` +
      `${String(result.copied)} copied, ${String(result.resumed)} resumed, ` +
      `${String(result.skipped)} already verified\n`,
  );
}

export async function runCaptureFactoryCli(args: readonly string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    options: CLI_OPTIONS,
    strict: true,
    allowPositionals: true,
  });
  if (parsed.positionals.length !== 1) {
    throw new Error("command must be exactly one of: inspect, stage");
  }
  const command = parsed.positionals[0];
  if (command === undefined) throw new Error("capture factory command is required");
  if (command === "inspect") {
    await runInspect(parsed.values);
  } else if (command === "stage") {
    await runStage(parsed.values);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
}
