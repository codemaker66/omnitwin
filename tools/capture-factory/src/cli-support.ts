import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runFoundryPhase1 } from "./foundry-phase1.js";
import { prepareGrandHallOfflineReview } from "./grand-hall-offline-review.js";
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
  "identity-review": { type: "string" },
  "capture-stage": { type: "string" },
  colmap: { type: "string" },
  output: { type: "string" },
  "project-id": { type: "string" },
  "created-by": { type: "string" },
  "created-at": { type: "string" },
  "phase1-package": { type: "string" },
  "identity-overview": { type: "string" },
  "prepared-release": { type: "string" },
  "prepared-source-manifest": { type: "string" },
  "audit-report": { type: "string" },
  "audit-evidence": { type: "string" },
  "gate-intake": { type: "string" },
} as const;

type CliValues = {
  source?: string;
  staging?: string;
  report?: string;
  "hash-all"?: boolean;
  "identity-review"?: string;
  "capture-stage"?: string;
  colmap?: string;
  output?: string;
  "project-id"?: string;
  "created-by"?: string;
  "created-at"?: string;
  "phase1-package"?: string;
  "identity-overview"?: string;
  "prepared-release"?: string;
  "prepared-source-manifest"?: string;
  "audit-report"?: string;
  "audit-evidence"?: string;
  "gate-intake"?: string;
};

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") throw new Error(`--${name} is required`);
  return value;
}

function rejectOption(name: string, value: string | undefined): void {
  if (value !== undefined) throw new Error(`--${name} is not valid for this command`);
}

function rejectPhase1Options(values: CliValues): void {
  for (const [name, value] of [
    ["identity-review", values["identity-review"]],
    ["capture-stage", values["capture-stage"]],
    ["colmap", values.colmap],
    ["output", values.output],
    ["project-id", values["project-id"]],
    ["created-by", values["created-by"]],
    ["created-at", values["created-at"]],
  ] as const) {
    rejectOption(name, value);
  }
}

function rejectOfflineReviewOptions(values: CliValues): void {
  for (const [name, value] of [
    ["phase1-package", values["phase1-package"]],
    ["identity-overview", values["identity-overview"]],
    ["prepared-release", values["prepared-release"]],
    ["prepared-source-manifest", values["prepared-source-manifest"]],
    ["audit-report", values["audit-report"]],
    ["audit-evidence", values["audit-evidence"]],
    ["gate-intake", values["gate-intake"]],
  ] as const) {
    rejectOption(name, value);
  }
}

async function runInspect(values: CliValues): Promise<void> {
  rejectOption("staging", values.staging);
  rejectPhase1Options(values);
  rejectOfflineReviewOptions(values);
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

async function runStage(values: CliValues): Promise<void> {
  rejectOption("report", values.report);
  rejectPhase1Options(values);
  rejectOfflineReviewOptions(values);
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

function rejectLegacyOptions(values: CliValues): void {
  rejectOption("source", values.source);
  rejectOption("staging", values.staging);
  rejectOption("report", values.report);
  if (values["hash-all"] === true) throw new Error("--hash-all is not valid for foundry-phase1");
}

async function runPhase1(values: CliValues): Promise<void> {
  rejectLegacyOptions(values);
  rejectOfflineReviewOptions(values);
  const result = await runFoundryPhase1({
    identityReviewPath: required("identity-review", values["identity-review"]),
    captureStageRoot: required("capture-stage", values["capture-stage"]),
    colmapRoot: required("colmap", values.colmap),
    outputDirectory: required("output", values.output),
    projectId: values["project-id"] ?? "grand-hall-phase1",
    createdBy: required("created-by", values["created-by"]),
    createdAt: required("created-at", values["created-at"]),
  });
  process.stdout.write(
    `foundry phase 1 complete: ${String(result.assetCount)} immutable inputs, ` +
      `${result.manifestSha256}, output ${result.outputDirectory}\n`,
  );
}

async function runOfflineReview(values: CliValues): Promise<void> {
  rejectLegacyOptions(values);
  rejectOption("identity-review", values["identity-review"]);
  rejectOption("capture-stage", values["capture-stage"]);
  rejectOption("colmap", values.colmap);
  const result = await prepareGrandHallOfflineReview({
    phase1PackageRoot: required("phase1-package", values["phase1-package"]),
    identityOverviewPath: required("identity-overview", values["identity-overview"]),
    preparedReleaseRoot: required("prepared-release", values["prepared-release"]),
    preparedSourceManifestPath: required(
      "prepared-source-manifest",
      values["prepared-source-manifest"],
    ),
    auditReportPath: required("audit-report", values["audit-report"]),
    auditEvidencePath: required("audit-evidence", values["audit-evidence"]),
    gateIntakePath: required("gate-intake", values["gate-intake"]),
    outputDirectory: required("output", values.output),
    projectId: values["project-id"] ?? "grand-hall-t486-offline-preflight",
    createdBy: required("created-by", values["created-by"]),
    createdAt: required("created-at", values["created-at"]),
  });
  process.stdout.write(
    `offline review package complete: ${String(result.artifactCount)} artifacts, ` +
      `${result.packageSha256}, audit target ${result.releaseDigest}, output ${result.outputDirectory}\n`,
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
    throw new Error(
      "command must be exactly one of: inspect, stage, foundry-phase1, grand-hall-offline-review",
    );
  }
  const command = parsed.positionals[0];
  if (command === undefined) throw new Error("capture factory command is required");
  if (command === "inspect") {
    await runInspect(parsed.values);
  } else if (command === "stage") {
    await runStage(parsed.values);
  } else if (command === "foundry-phase1") {
    await runPhase1(parsed.values);
  } else if (command === "grand-hall-offline-review") {
    await runOfflineReview(parsed.values);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
}
