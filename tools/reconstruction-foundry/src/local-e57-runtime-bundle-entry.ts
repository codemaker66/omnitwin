import { lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { stableCanonicalJson, toCanonicalJson } from "@omnitwin/reconstruction-foundry";
import {
  materializeLocalE57RuntimeBundle,
  type LocalE57RuntimeBundleBuildInput,
} from "./local-e57-runtime-bundle-builder.js";
import {
  assertLocalE57RuntimeBundleUnchanged,
  verifyLocalE57RuntimeBundleOnDisk,
} from "./local-e57-runtime-bundle-verifier.js";

interface BuildSpec extends Omit<LocalE57RuntimeBundleBuildInput, "environment" | "signal"> {
  readonly environmentPath: string;
  readonly receiptOutputPath: string;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function parseBuildSpec(input: unknown): BuildSpec {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !hasExactKeys(input as Record<string, unknown>, [
      "artifacts",
      "createdAtUtc",
      "environmentPath",
      "externalLegalMaterials",
      "outputRootPath",
      "probeScriptPath",
      "pybind11LicensePath",
      "receiptOutputPath",
    ])
  ) {
    throw new Error("The materialization spec has unexpected or missing fields.");
  }
  const value = input as Record<string, unknown>;
  for (const key of [
    "createdAtUtc",
    "environmentPath",
    "outputRootPath",
    "probeScriptPath",
    "pybind11LicensePath",
    "receiptOutputPath",
  ]) {
    if (typeof value[key] !== "string") throw new Error(`Spec field must be a string: ${key}`);
  }
  if (
    value.artifacts === null ||
    typeof value.artifacts !== "object" ||
    Array.isArray(value.artifacts) ||
    !hasExactKeys(value.artifacts as Record<string, unknown>, [
      "cpython-runtime",
      "numpy-wheel",
      "pye57-wheel",
      "pyquaternion-wheel",
    ]) ||
    Object.values(value.artifacts).some((path) => typeof path !== "string") ||
    value.externalLegalMaterials === null ||
    typeof value.externalLegalMaterials !== "object" ||
    Array.isArray(value.externalLegalMaterials) ||
    Object.values(value.externalLegalMaterials).some((path) => typeof path !== "string")
  ) {
    throw new Error("The materialization spec contains invalid artifact or legal-material paths.");
  }
  const artifacts = value.artifacts as Record<string, string>;
  const externalLegalMaterials = value.externalLegalMaterials as Record<string, string>;
  return {
    artifacts: {
      "cpython-runtime": artifacts["cpython-runtime"] ?? "",
      "numpy-wheel": artifacts["numpy-wheel"] ?? "",
      "pye57-wheel": artifacts["pye57-wheel"] ?? "",
      "pyquaternion-wheel": artifacts["pyquaternion-wheel"] ?? "",
    },
    createdAtUtc: value.createdAtUtc as string,
    environmentPath: value.environmentPath as string,
    externalLegalMaterials,
    outputRootPath: value.outputRootPath as string,
    probeScriptPath: value.probeScriptPath as string,
    pybind11LicensePath: value.pybind11LicensePath as string,
    receiptOutputPath: value.receiptOutputPath as string,
  };
}

async function assertReceiptOutputAvailable(
  outputRootPath: string,
  receiptOutputPath: string,
): Promise<void> {
  if (!isAbsolute(outputRootPath) || !isAbsolute(receiptOutputPath)) {
    throw new Error("Bundle and receipt outputs must be absolute paths.");
  }
  const output = resolve(outputRootPath);
  const receipt = resolve(receiptOutputPath);
  if (receipt !== `${output}.receipt.json`) {
    throw new Error("The receipt output must be the bundle path plus .receipt.json.");
  }
  const parent = dirname(receipt);
  const parentStats = await lstat(parent);
  if (
    parentStats.isSymbolicLink() ||
    !parentStats.isDirectory() ||
    resolve(await realpath(parent)).toLowerCase() !== resolve(parent).toLowerCase()
  ) {
    throw new Error("The receipt output parent must be a canonical regular directory.");
  }
  try {
    await lstat(receipt);
    throw new Error("The receipt output already exists; materialization never overwrites it.");
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("already exists")) throw error;
    const code = error !== null && typeof error === "object" && "code" in error
      ? error.code
      : null;
    if (code !== "ENOENT") throw error;
  }
}

export async function materializeLocalE57RuntimeBundleFromSpec(
  specPath: string,
): Promise<void> {
  if (!isAbsolute(specPath)) throw new Error("The materialization spec path must be absolute.");
  const spec = parseBuildSpec(JSON.parse(await readFile(specPath, "utf8")) as unknown);
  await assertReceiptOutputAvailable(spec.outputRootPath, spec.receiptOutputPath);
  const environment = JSON.parse(await readFile(spec.environmentPath, "utf8")) as unknown;
  const result = await materializeLocalE57RuntimeBundle({
    artifacts: spec.artifacts,
    createdAtUtc: spec.createdAtUtc,
    environment,
    externalLegalMaterials: spec.externalLegalMaterials,
    outputRootPath: spec.outputRootPath,
    probeScriptPath: spec.probeScriptPath,
    pybind11LicensePath: spec.pybind11LicensePath,
  });
  try {
    await writeFile(spec.receiptOutputPath, result.receiptCanonicalBytes, { flag: "wx" });
  } catch (receiptError: unknown) {
    try {
      const publishedRoot = resolve(result.outputRootPath);
      if (
        publishedRoot !== resolve(spec.outputRootPath) ||
        dirname(publishedRoot) !== dirname(resolve(spec.receiptOutputPath))
      ) {
        throw new Error("Published bundle path no longer matches the reviewed output pair.");
      }
      const verified = await verifyLocalE57RuntimeBundleOnDisk({
        receipt: result.receipt,
        rootPath: publishedRoot,
      });
      assertLocalE57RuntimeBundleUnchanged(result.snapshot, verified.snapshot);
      await rm(publishedRoot, { force: false, recursive: true });
    } catch (rollbackError: unknown) {
      throw new AggregateError(
        [receiptError, rollbackError],
        "The receipt sidecar could not be written and the exact published bundle could not be rolled back safely.",
      );
    }
    throw receiptError;
  }
  process.stdout.write(`${stableCanonicalJson(toCanonicalJson({
    bundleReceiptSha256: result.receipt.bundleReceiptSha256,
    fileCount: result.snapshot.fileCount,
    outputRootPath: result.outputRootPath,
    receiptByteSize: result.receiptCanonicalBytes.byteLength,
    receiptOutputPath: spec.receiptOutputPath,
    totalFileBytes: result.snapshot.totalFileBytes,
  }))}\n`);
}

const specPath = process.argv[2];
if (specPath === undefined) {
  throw new Error("Usage: materialize:e57-runtime -- <absolute-spec.json>");
}
await materializeLocalE57RuntimeBundleFromSpec(specPath);
