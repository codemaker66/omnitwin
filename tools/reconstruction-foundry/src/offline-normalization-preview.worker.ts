import { parentPort, workerData } from "node:worker_threads";
import {
  runFoundryOfflineNormalizeMeshGlbPreview,
} from "../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview.js";
import {
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_INPUT_V0,
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0,
  type LocalOfflineNormalizationPreviewHelperInput,
} from "./local-offline-normalization-preview.js";

const ERROR_CODE = /^[A-Z0-9_]{3,128}$/u;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function parseInput(value: unknown): LocalOfflineNormalizationPreviewHelperInput {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value as Record<string, unknown>, [
      "invocation",
      "permitEnvelope",
      "pinnedTrustedPermitKeys",
      "schemaVersion",
      "sourceBytes",
    ])
  ) {
    throw Object.assign(new Error("Invalid helper input."), {
      code: "LOCAL_OFFLINE_PREVIEW_HELPER_INPUT_INVALID",
    });
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !==
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_INPUT_V0 ||
    !(raw.sourceBytes instanceof ArrayBuffer) ||
    !(raw.pinnedTrustedPermitKeys instanceof Map)
  ) {
    throw Object.assign(new Error("Invalid helper input."), {
      code: "LOCAL_OFFLINE_PREVIEW_HELPER_INPUT_INVALID",
    });
  }
  return {
    schemaVersion: LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_INPUT_V0,
    sourceBytes: raw.sourceBytes,
    invocation: raw.invocation as LocalOfflineNormalizationPreviewHelperInput["invocation"],
    permitEnvelope: raw.permitEnvelope,
    pinnedTrustedPermitKeys:
      raw.pinnedTrustedPermitKeys as LocalOfflineNormalizationPreviewHelperInput["pinnedTrustedPermitKeys"],
  };
}

function bestEffortOverwrite(bytes: Uint8Array | null): void {
  if (bytes === null) return;
  try {
    bytes.fill(0);
  } catch {
    // Best effort only; this is not a secure-erasure claim.
  }
}

function codeFor(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string" &&
    ERROR_CODE.test((error as { readonly code: string }).code)
  ) {
    return (error as { readonly code: string }).code;
  }
  return "LOCAL_OFFLINE_PREVIEW_HELPER_FAILED";
}

async function main(): Promise<void> {
  if (parentPort === null) {
    throw new Error("The offline normalization helper requires a parent port.");
  }
  let source: Uint8Array | null = null;
  try {
    const input = parseInput(workerData);
    source = new Uint8Array(input.sourceBytes);
    const result = await runFoundryOfflineNormalizeMeshGlbPreview({
      invocation: input.invocation,
      sourceBytes: source,
      permitEnvelope: input.permitEnvelope,
      pinnedTrustedPermitKeys: input.pinnedTrustedPermitKeys,
    });
    const output = Uint8Array.from(result.normalizedGlb);
    bestEffortOverwrite(source);
    source = null;
    parentPort.postMessage(
      {
        schemaVersion:
          LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0,
        kind: "completed",
        normalizedGlb: output.buffer,
        report: result.report,
      },
      [output.buffer],
    );
  } catch (error: unknown) {
    bestEffortOverwrite(source);
    source = null;
    parentPort.postMessage({
      schemaVersion: LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0,
      kind: "failed",
      code: codeFor(error),
    });
  } finally {
    parentPort.close();
  }
}

void main();
