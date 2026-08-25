/**
 * Read-only operator entry point. Prints a path-redacted deterministic receipt
 * to stdout and optionally checks the committed evidence projection.
 */

import { readFileSync } from "node:fs";

import type { JsonValue } from "./grand-hall-room9-boundary.js";
import {
  createGrandHallRoom9SourceReceiptFromFiles,
  GRAND_HALL_ROOM9_SOURCE_RECEIPT_FATAL_MESSAGE,
  verifyGrandHallRoom9EvidenceAgainstReceipt,
} from "./grand-hall-room9-source-receipt.js";

const USAGE = [
  "Usage:",
  "  Set GRAND_HALL_ROOM9_CAPTURE_STAGE_ROOT, GRAND_HALL_ROOM9_POSE_EVIDENCE_ROOT,",
  "  and GRAND_HALL_ROOM9_IMAGE_PROBE_EVIDENCE in the operator environment, then run:",
  "  pnpm --filter @omnitwin/reconstruction-foundry-cli exec tsx",
  "    src/grand-hall-room9-source-receipt-entry.mts",
  "    [--check-artifact]",
  "",
  "Reads only. Absolute operator paths are never included in the receipt.",
].join("\n");

function canonicalJsonValue(value: unknown, label = "$artifact"): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      canonicalJsonValue(entry, `${label}[${String(index)}]`),
    );
  }
  if (typeof value === "object") {
    const output: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = canonicalJsonValue(entry, `${label}.${key}`);
    }
    return output;
  }
  throw new Error(`${label} is not canonical JSON`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`missing environment ${name}`);
  return value;
}

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((value) => value !== "--check-artifact") || arguments_.length > 1) {
    throw new Error(`invalid invocation\n${USAGE}`);
  }
  const receipt = createGrandHallRoom9SourceReceiptFromFiles({
    captureStageRoot: requiredEnvironment("GRAND_HALL_ROOM9_CAPTURE_STAGE_ROOT"),
    poseEvidenceRoot: requiredEnvironment("GRAND_HALL_ROOM9_POSE_EVIDENCE_ROOT"),
    imageProbeEvidencePath: requiredEnvironment("GRAND_HALL_ROOM9_IMAGE_PROBE_EVIDENCE"),
  });
  if (arguments_[0] === "--check-artifact") {
    const artifactUrl = new URL(
      "../../../docs/operations/grand-hall-room9-source-boundary-evidence-v1.json",
      import.meta.url,
    );
    const artifact: unknown = JSON.parse(readFileSync(artifactUrl, "utf8"));
    verifyGrandHallRoom9EvidenceAgainstReceipt(canonicalJsonValue(artifact), receipt);
  }
  process.stdout.write(`${JSON.stringify(receipt.document, null, 2)}\n`);
} catch (error) {
  // Filesystem exceptions commonly echo the operator's absolute source path.
  // Fail with a fixed value so logs cannot become a second path-leak channel.
  void error;
  process.stderr.write(`${GRAND_HALL_ROOM9_SOURCE_RECEIPT_FATAL_MESSAGE}\n`);
  process.exitCode = 1;
}
