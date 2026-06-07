import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
} from "./canonical-layout-snapshot.js";
import { CrowdSimulatorSourceNameSchema } from "./crowd-simulation-replay.js";
import {
  ScenarioInstanceArtifactRefSchema,
  ScenarioInstanceAssumptionRefSchema,
  ScenarioInstanceSeedRefSchema,
  ScenarioInstanceV0Schema,
  type ScenarioInstanceAssumptionRef,
  type ScenarioInstanceSeedRef,
  type ScenarioInstanceV0,
} from "./scenario-instance.js";
import {
  VENREPLAY_MANIFEST_FILE_PATH,
  VENREPLAY_PAYLOAD_FILE_PATHS,
  VENREPLAY_REQUIRED_FILE_PATHS,
  VENREPLAY_REQUIRED_PAYLOAD_FILE_PATHS,
  VenreplayFilePathSchema,
  VenreplayManifestV0Schema,
  venreplayLogicalArtifactDigest,
  type VenreplayFileHash,
  type VenreplayFilePath,
  type VenreplayManifestV0,
  type VenreplayPayloadFilePath,
} from "./venreplay-artifact.js";

export const VENREPLAY_WITNESS_SCHEMA_VERSION = "venviewer.venreplay-witness.v0";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const SLUG_TOKEN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;

export const VENREPLAY_STRUCTURED_TEXT_FILE_PATHS = [
  "manifest.json",
  "geometry.geojson",
  "scenario.json",
  "agents.csv",
  "trajectory.csv",
  "metrics.json",
  "bottlenecks.geojson",
  "witness.json",
] as const;
export const VenreplayStructuredTextFilePathSchema = z.enum(
  VENREPLAY_STRUCTURED_TEXT_FILE_PATHS,
);
export type VenreplayStructuredTextFilePath = z.infer<
  typeof VenreplayStructuredTextFilePathSchema
>;

export const VENREPLAY_STRUCTURED_JSON_FILE_PATHS = [
  "manifest.json",
  "geometry.geojson",
  "scenario.json",
  "metrics.json",
  "bottlenecks.geojson",
  "witness.json",
] as const;
export const VenreplayStructuredJsonFilePathSchema = z.enum(
  VENREPLAY_STRUCTURED_JSON_FILE_PATHS,
);
export type VenreplayStructuredJsonFilePath = z.infer<
  typeof VenreplayStructuredJsonFilePathSchema
>;

export const VENREPLAY_VALIDATION_ISSUE_CODES = [
  "invalid_path",
  "duplicate_file",
  "missing_file",
  "missing_hash_entry",
  "unexpected_hash_entry",
  "hash_mismatch",
  "byte_size_mismatch",
  "utf8_decode_failed",
  "json_parse_failed",
  "manifest_schema_invalid",
  "scenario_schema_invalid",
  "scenario_mismatch",
  "witness_schema_invalid",
  "witness_mismatch",
  "unsafe_public_claim_language",
  "logical_digest_failed",
] as const;
export const VenreplayValidationIssueCodeSchema = z.enum(
  VENREPLAY_VALIDATION_ISSUE_CODES,
);
export type VenreplayValidationIssueCode = z.infer<
  typeof VenreplayValidationIssueCodeSchema
>;

export const VenreplayWitnessV0Schema = z.object({
  schemaVersion: z.literal(VENREPLAY_WITNESS_SCHEMA_VERSION),
  scenarioTemplateId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN),
  scenarioTemplateVersion: z.string().trim().min(1).max(80),
  scenarioInstanceId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN),
  layoutSnapshotHash: z.string().regex(SHA256_HEX),
  runtimePackageId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN).nullable(),
  runtimePackageHash: z.string().regex(SHA256_HEX).nullable(),
  policyBundleDigest: z.string().regex(SHA256_HEX).nullable(),
  simulatorName: CrowdSimulatorSourceNameSchema,
  simulatorVersion: z.string().trim().min(1).max(120).nullable(),
  simulatorHash: z.string().regex(SHA256_HEX).nullable(),
  seed: ScenarioInstanceSeedRefSchema,
  assumptions: z.array(ScenarioInstanceAssumptionRefSchema).min(1),
  limitations: z.array(z.string().trim().min(1).max(1000)).min(1),
  witnessBlockRef: ScenarioInstanceArtifactRefSchema,
  generatedAt: z.string().datetime(),
  facts: z.record(CanonicalJsonValueSchema).optional(),
}).strict().superRefine((witness, ctx) => {
  if (witness.witnessBlockRef.refType !== "witness_block") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["witnessBlockRef"],
      message: "witnessBlockRef must use refType witness_block.",
    });
  }
});
export type VenreplayWitnessV0 = z.infer<typeof VenreplayWitnessV0Schema>;

export type VenreplayArtifactFileContent = string | Uint8Array;

export interface VenreplayArtifactFile {
  readonly path: string;
  readonly content: VenreplayArtifactFileContent;
}

export interface VenreplayValidationIssue {
  readonly code: VenreplayValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface VenreplayFileIntegrityResult {
  readonly path: VenreplayPayloadFilePath;
  readonly expectedSha256: string;
  readonly actualSha256: string | null;
  readonly expectedByteSize: number;
  readonly actualByteSize: number | null;
}

export interface VenreplayArtifactValidationResult {
  readonly valid: boolean;
  readonly manifest: VenreplayManifestV0 | null;
  readonly scenario: ScenarioInstanceV0 | null;
  readonly witness: VenreplayWitnessV0 | null;
  readonly manifestFileSha256: string | null;
  readonly manifestFileByteSize: number | null;
  readonly logicalArtifactDigest: string | null;
  readonly fileIntegrity: readonly VenreplayFileIntegrityResult[];
  readonly issues: readonly VenreplayValidationIssue[];
}

interface ParsedFiles {
  readonly filesByPath: ReadonlyMap<VenreplayFilePath, VenreplayArtifactFileContent>;
  readonly issues: readonly VenreplayValidationIssue[];
}

interface TextFiles {
  readonly textByPath: ReadonlyMap<VenreplayStructuredTextFilePath, string>;
  readonly issues: readonly VenreplayValidationIssue[];
}

interface JsonParseResult {
  readonly value: unknown;
  readonly issue: VenreplayValidationIssue | null;
}

const STRUCTURED_TEXT_PATH_SET: ReadonlySet<VenreplayFilePath> = new Set(
  VENREPLAY_STRUCTURED_TEXT_FILE_PATHS,
);
const PAYLOAD_PATH_SET: ReadonlySet<VenreplayFilePath> = new Set(
  VENREPLAY_PAYLOAD_FILE_PATHS,
);

export function validateVenreplayArtifact(
  files: readonly VenreplayArtifactFile[],
): VenreplayArtifactValidationResult {
  const parsedFiles = parseFiles(files);
  const textFiles = decodeStructuredTextFiles(parsedFiles.filesByPath);
  const issues: VenreplayValidationIssue[] = [
    ...parsedFiles.issues,
    ...textFiles.issues,
  ];

  validateRequiredFiles(parsedFiles.filesByPath, issues);
  validateUnsafePublicClaimLanguage(textFiles.textByPath, issues);
  validateJsonFiles(textFiles.textByPath, issues);

  const manifestText = textFiles.textByPath.get(VENREPLAY_MANIFEST_FILE_PATH) ?? null;
  const manifest = parseManifest(manifestText, issues);
  const scenario = parseScenario(textFiles.textByPath.get("scenario.json") ?? null, issues);
  const witness = parseWitness(textFiles.textByPath.get("witness.json") ?? null, issues);
  const manifestFileSha256 = manifestText === null ? null : sha256Hex(manifestText);
  const manifestFileByteSize = manifestText === null ? null : byteLength(manifestText);
  const fileIntegrity = manifest === null
    ? []
    : validateFileIntegrity(manifest, parsedFiles.filesByPath, issues);
  const logicalArtifactDigest = computeLogicalArtifactDigest(manifest, issues);

  if (manifest !== null && scenario !== null) {
    validateScenarioMatchesManifest(scenario, manifest, issues);
  }

  if (manifest !== null && witness !== null) {
    validateWitnessMatchesManifest(witness, manifest, issues);
  }

  return {
    valid: issues.length === 0,
    manifest,
    scenario,
    witness,
    manifestFileSha256,
    manifestFileByteSize,
    logicalArtifactDigest,
    fileIntegrity,
    issues,
  };
}

function parseFiles(files: readonly VenreplayArtifactFile[]): ParsedFiles {
  const filesByPath = new Map<VenreplayFilePath, VenreplayArtifactFileContent>();
  const issues: VenreplayValidationIssue[] = [];

  for (const file of files) {
    const pathResult = VenreplayFilePathSchema.safeParse(file.path);
    if (!pathResult.success) {
      issues.push(issue("invalid_path", file.path, "File path is not allowed in venreplay v0."));
      continue;
    }

    if (filesByPath.has(pathResult.data)) {
      issues.push(issue("duplicate_file", pathResult.data, "Duplicate file entry."));
      continue;
    }

    filesByPath.set(pathResult.data, file.content);
  }

  return { filesByPath, issues };
}

function decodeStructuredTextFiles(filesByPath: ReadonlyMap<VenreplayFilePath, VenreplayArtifactFileContent>): TextFiles {
  const textByPath = new Map<VenreplayStructuredTextFilePath, string>();
  const issues: VenreplayValidationIssue[] = [];

  for (const [path, content] of filesByPath) {
    if (!STRUCTURED_TEXT_PATH_SET.has(path)) {
      continue;
    }

    const parsedPath = VenreplayStructuredTextFilePathSchema.parse(path);
    const decoded = decodeTextContent(content);
    if (decoded === null) {
      issues.push(issue("utf8_decode_failed", path, "Structured venreplay file must be UTF-8 text."));
      continue;
    }

    textByPath.set(parsedPath, decoded);
  }

  return { textByPath, issues };
}

function validateRequiredFiles(
  filesByPath: ReadonlyMap<VenreplayFilePath, VenreplayArtifactFileContent>,
  issues: VenreplayValidationIssue[],
): void {
  for (const path of VENREPLAY_REQUIRED_FILE_PATHS) {
    if (!filesByPath.has(path)) {
      issues.push(issue("missing_file", path, "Required venreplay file is missing."));
    }
  }
}

function validateUnsafePublicClaimLanguage(
  textByPath: ReadonlyMap<VenreplayStructuredTextFilePath, string>,
  issues: VenreplayValidationIssue[],
): void {
  for (const [path, text] of textByPath) {
    for (const pattern of UNSAFE_PUBLIC_CLAIM_PATTERNS) {
      if (pattern.pattern.test(text)) {
        issues.push(
          issue(
            "unsafe_public_claim_language",
            path,
            `Portable replay file contains unsupported public-claim wording: ${pattern.id}.`,
          ),
        );
      }
    }
  }
}

function validateJsonFiles(
  textByPath: ReadonlyMap<VenreplayStructuredTextFilePath, string>,
  issues: VenreplayValidationIssue[],
): void {
  for (const [path, text] of textByPath) {
    const jsonPath = VenreplayStructuredJsonFilePathSchema.safeParse(path);
    if (!jsonPath.success) {
      continue;
    }

    if (path === "manifest.json" || path === "scenario.json" || path === "witness.json") {
      continue;
    }

    const parsed = parseJson(text, jsonPath.data);
    if (parsed.issue !== null) {
      issues.push(parsed.issue);
    }
  }
}

function parseManifest(
  manifestText: string | null,
  issues: VenreplayValidationIssue[],
): VenreplayManifestV0 | null {
  if (manifestText === null) {
    return null;
  }

  const json = parseJson(manifestText, VENREPLAY_MANIFEST_FILE_PATH);
  if (json.issue !== null) {
    issues.push(json.issue);
    return null;
  }

  const parsed = VenreplayManifestV0Schema.safeParse(json.value);
  if (!parsed.success) {
    issues.push(issue("manifest_schema_invalid", VENREPLAY_MANIFEST_FILE_PATH, "manifest.json failed VenreplayManifestV0Schema."));
    return null;
  }

  return parsed.data;
}

function parseScenario(
  scenarioText: string | null,
  issues: VenreplayValidationIssue[],
): ScenarioInstanceV0 | null {
  if (scenarioText === null) {
    return null;
  }

  const json = parseJson(scenarioText, "scenario.json");
  if (json.issue !== null) {
    issues.push(json.issue);
    return null;
  }

  const parsed = ScenarioInstanceV0Schema.safeParse(json.value);
  if (!parsed.success) {
    issues.push(issue("scenario_schema_invalid", "scenario.json", "scenario.json failed ScenarioInstanceV0Schema."));
    return null;
  }

  return parsed.data;
}

function parseWitness(
  witnessText: string | null,
  issues: VenreplayValidationIssue[],
): VenreplayWitnessV0 | null {
  if (witnessText === null) {
    return null;
  }

  const json = parseJson(witnessText, "witness.json");
  if (json.issue !== null) {
    issues.push(json.issue);
    return null;
  }

  const parsed = VenreplayWitnessV0Schema.safeParse(json.value);
  if (!parsed.success) {
    issues.push(issue("witness_schema_invalid", "witness.json", "witness.json failed VenreplayWitnessV0Schema."));
    return null;
  }

  return parsed.data;
}

function validateFileIntegrity(
  manifest: VenreplayManifestV0,
  filesByPath: ReadonlyMap<VenreplayFilePath, VenreplayArtifactFileContent>,
  issues: VenreplayValidationIssue[],
): VenreplayFileIntegrityResult[] {
  const integrity: VenreplayFileIntegrityResult[] = [];
  const hashByPath = new Map<VenreplayPayloadFilePath, VenreplayFileHash>();

  for (const fileHash of manifest.fileHashes) {
    hashByPath.set(fileHash.path, fileHash);
    const content = filesByPath.get(fileHash.path);
    const actualSha256 = content === undefined ? null : sha256Hex(content);
    const actualByteSize = content === undefined ? null : byteLength(content);
    integrity.push({
      path: fileHash.path,
      expectedSha256: fileHash.sha256,
      actualSha256,
      expectedByteSize: fileHash.byteSize,
      actualByteSize,
    });

    if (content === undefined) {
      issues.push(issue("missing_file", fileHash.path, "Manifest lists a file that is not present."));
      continue;
    }

    if (actualSha256 !== fileHash.sha256) {
      issues.push(issue("hash_mismatch", fileHash.path, "File SHA-256 does not match manifest fileHashes."));
    }

    if (actualByteSize !== fileHash.byteSize) {
      issues.push(issue("byte_size_mismatch", fileHash.path, "File byte size does not match manifest fileHashes."));
    }
  }

  for (const path of VENREPLAY_REQUIRED_PAYLOAD_FILE_PATHS) {
    if (!hashByPath.has(path)) {
      issues.push(issue("missing_hash_entry", path, "Required payload file is missing a hash entry."));
    }
  }

  for (const [path] of filesByPath) {
    if (!PAYLOAD_PATH_SET.has(path)) {
      continue;
    }

    const payloadPath = path as VenreplayPayloadFilePath;
    if (!hashByPath.has(payloadPath)) {
      issues.push(issue("missing_hash_entry", path, "Present payload file is missing a hash entry."));
    }
  }

  return integrity;
}

function validateScenarioMatchesManifest(
  scenario: ScenarioInstanceV0,
  manifest: VenreplayManifestV0,
  issues: VenreplayValidationIssue[],
): void {
  compareField("scenario.json", "scenario_mismatch", scenario.instanceId, manifest.scenarioInstanceId, "Scenario instance ID must match manifest.", issues);
  compareField("scenario.json", "scenario_mismatch", scenario.templateId, manifest.scenarioTemplateId, "Scenario template ID must match manifest.", issues);
  compareField("scenario.json", "scenario_mismatch", scenario.templateVersion, manifest.scenarioTemplateVersion, "Scenario template version must match manifest.", issues);
  compareField("scenario.json", "scenario_mismatch", scenario.layoutSnapshotDigest, manifest.layoutSnapshotHash, "Layout snapshot hash must match manifest.", issues);
  compareField("scenario.json", "scenario_mismatch", scenario.runtimePackageId, manifest.runtimePackageId, "Runtime package ID must match manifest.", issues);
  compareField("scenario.json", "scenario_mismatch", scenario.runtimePackageHash, manifest.runtimePackageHash, "Runtime package hash must match manifest.", issues);
  compareField("scenario.json", "scenario_mismatch", scenario.policyBundle.policyBundleDigest, manifest.policyBundleDigest, "Policy bundle digest must match manifest.", issues);

  if (scenario.simulator === null) {
    issues.push(issue("scenario_mismatch", "scenario.json", "Scenario file must include simulator metadata."));
  } else {
    compareField("scenario.json", "scenario_mismatch", scenario.simulator.simulatorName, manifest.simulatorName, "Simulator name must match manifest.", issues);
    compareField("scenario.json", "scenario_mismatch", scenario.simulator.simulatorVersion, manifest.simulatorVersion, "Simulator version must match manifest.", issues);
    compareField("scenario.json", "scenario_mismatch", scenario.simulator.simulatorHash, manifest.simulatorHash, "Simulator hash must match manifest.", issues);
  }

  if (!seedRefsEqual(scenario.seed, manifest.seed)) {
    issues.push(issue("scenario_mismatch", "scenario.json", "Seed metadata must match manifest."));
  }

  if (!assumptionRefsEqual(scenario.assumptionRefs, manifest.assumptions)) {
    issues.push(issue("scenario_mismatch", "scenario.json", "Scenario assumptions must match manifest assumptions."));
  }
}

function validateWitnessMatchesManifest(
  witness: VenreplayWitnessV0,
  manifest: VenreplayManifestV0,
  issues: VenreplayValidationIssue[],
): void {
  compareField("witness.json", "witness_mismatch", witness.scenarioTemplateId, manifest.scenarioTemplateId, "Witness scenario template ID must match manifest.", issues);
  compareField("witness.json", "witness_mismatch", witness.scenarioTemplateVersion, manifest.scenarioTemplateVersion, "Witness scenario template version must match manifest.", issues);
  compareField("witness.json", "witness_mismatch", witness.scenarioInstanceId, manifest.scenarioInstanceId, "Witness scenario instance ID must match manifest.", issues);
  compareField("witness.json", "witness_mismatch", witness.layoutSnapshotHash, manifest.layoutSnapshotHash, "Witness layout snapshot hash must match manifest.", issues);
  compareField("witness.json", "witness_mismatch", witness.runtimePackageId, manifest.runtimePackageId, "Witness runtime package ID must match manifest.", issues);
  compareField("witness.json", "witness_mismatch", witness.runtimePackageHash, manifest.runtimePackageHash, "Witness runtime package hash must match manifest.", issues);
  compareField("witness.json", "witness_mismatch", witness.policyBundleDigest, manifest.policyBundleDigest, "Witness policy bundle digest must match manifest.", issues);
  compareField("witness.json", "witness_mismatch", witness.simulatorName, manifest.simulatorName, "Witness simulator name must match manifest.", issues);
  compareField("witness.json", "witness_mismatch", witness.simulatorVersion, manifest.simulatorVersion, "Witness simulator version must match manifest.", issues);
  compareField("witness.json", "witness_mismatch", witness.simulatorHash, manifest.simulatorHash, "Witness simulator hash must match manifest.", issues);

  if (!seedRefsEqual(witness.seed, manifest.seed)) {
    issues.push(issue("witness_mismatch", "witness.json", "Witness seed metadata must match manifest."));
  }

  if (!assumptionRefsEqual(witness.assumptions, manifest.assumptions)) {
    issues.push(issue("witness_mismatch", "witness.json", "Witness assumptions must match manifest assumptions."));
  }

  if (!artifactRefsEqual(witness.witnessBlockRef, manifest.scenarioInstance.witnessBlockRef)) {
    issues.push(issue("witness_mismatch", "witness.json", "Witness block reference must match scenario instance witness reference."));
  }
}

function computeLogicalArtifactDigest(
  manifest: VenreplayManifestV0 | null,
  issues: VenreplayValidationIssue[],
): string | null {
  if (manifest === null) {
    return null;
  }

  try {
    return venreplayLogicalArtifactDigest(manifest);
  } catch {
    issues.push(issue("logical_digest_failed", VENREPLAY_MANIFEST_FILE_PATH, "Logical artifact digest could not be computed."));
    return null;
  }
}

function parseJson(text: string, path: VenreplayStructuredJsonFilePath): JsonParseResult {
  try {
    const value: unknown = JSON.parse(text);
    return { value, issue: null };
  } catch {
    return {
      value: null,
      issue: issue("json_parse_failed", path, "Structured JSON file could not be parsed."),
    };
  }
}

function compareField(
  path: string,
  code: "scenario_mismatch" | "witness_mismatch",
  actual: string | null,
  expected: string | null,
  message: string,
  issues: VenreplayValidationIssue[],
): void {
  if (actual !== expected) {
    issues.push(issue(code, path, message));
  }
}

function seedRefsEqual(left: ScenarioInstanceSeedRef, right: ScenarioInstanceSeedRef): boolean {
  return stableCanonicalJson(left as CanonicalJsonValue) ===
    stableCanonicalJson(right as CanonicalJsonValue);
}

function assumptionRefsEqual(
  left: readonly ScenarioInstanceAssumptionRef[],
  right: readonly ScenarioInstanceAssumptionRef[],
): boolean {
  const normalizedLeft = [...left].sort(compareAssumptionRefs);
  const normalizedRight = [...right].sort(compareAssumptionRefs);
  return stableCanonicalJson(normalizedLeft as CanonicalJsonValue) ===
    stableCanonicalJson(normalizedRight as CanonicalJsonValue);
}

function artifactRefsEqual(
  left: VenreplayWitnessV0["witnessBlockRef"],
  right: VenreplayManifestV0["scenarioInstance"]["witnessBlockRef"],
): boolean {
  if (right === null) {
    return false;
  }

  return stableCanonicalJson(left as CanonicalJsonValue) ===
    stableCanonicalJson(right as CanonicalJsonValue);
}

function compareAssumptionRefs(
  left: ScenarioInstanceAssumptionRef,
  right: ScenarioInstanceAssumptionRef,
): number {
  return assumptionKey(left).localeCompare(assumptionKey(right));
}

function assumptionKey(assumption: ScenarioInstanceAssumptionRef): string {
  return `${assumption.assumptionId}\u0000${assumption.category}\u0000${assumption.contentHash ?? "null"}`;
}

function issue(
  code: VenreplayValidationIssueCode,
  path: string,
  message: string,
): VenreplayValidationIssue {
  return { code, path, message };
}

function decodeTextContent(content: VenreplayArtifactFileContent): string | null {
  if (typeof content === "string") {
    return content;
  }

  try {
    return decodeUtf8(content);
  } catch {
    return null;
  }
}

function byteLength(content: VenreplayArtifactFileContent): number {
  return typeof content === "string" ? utf8ByteLength(content) : content.byteLength;
}

function utf8ByteLength(input: string): number {
  let length = 0;
  for (const char of input) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }

    if (codePoint <= 0x7f) {
      length += 1;
    } else if (codePoint <= 0x7ff) {
      length += 2;
    } else if (codePoint <= 0xffff) {
      length += 3;
    } else {
      length += 4;
    }
  }
  return length;
}

function decodeUtf8(bytes: Uint8Array): string {
  let output = "";
  const chunk: number[] = [];
  const flushChunk = (): void => {
    if (chunk.length === 0) {
      return;
    }

    output += String.fromCodePoint(...chunk);
    chunk.length = 0;
  };
  const pushCodePoint = (codePoint: number): void => {
    chunk.push(codePoint);
    if (chunk.length >= 4096) {
      flushChunk();
    }
  };

  for (let index = 0; index < bytes.length; index += 1) {
    const first = bytes[index];
    if (first === undefined) {
      throw new Error("unexpected end of UTF-8 input");
    }

    if (first <= 0x7f) {
      pushCodePoint(first);
      continue;
    }

    if (first >= 0xc2 && first <= 0xdf) {
      const second = continuationByte(bytes, index + 1);
      pushCodePoint(((first & 0x1f) << 6) | (second & 0x3f));
      index += 1;
      continue;
    }

    if (first >= 0xe0 && first <= 0xef) {
      const second = continuationByte(bytes, index + 1);
      const third = continuationByte(bytes, index + 2);
      const codePoint = ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
      if (codePoint < 0x800 || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        throw new Error("invalid UTF-8 code point");
      }
      pushCodePoint(codePoint);
      index += 2;
      continue;
    }

    if (first >= 0xf0 && first <= 0xf4) {
      const second = continuationByte(bytes, index + 1);
      const third = continuationByte(bytes, index + 2);
      const fourth = continuationByte(bytes, index + 3);
      const codePoint =
        ((first & 0x07) << 18) |
        ((second & 0x3f) << 12) |
        ((third & 0x3f) << 6) |
        (fourth & 0x3f);
      if (codePoint < 0x10000 || codePoint > 0x10ffff) {
        throw new Error("invalid UTF-8 code point");
      }
      pushCodePoint(codePoint);
      index += 3;
      continue;
    }

    throw new Error("invalid UTF-8 lead byte");
  }

  flushChunk();
  return output;
}

function continuationByte(bytes: Uint8Array, index: number): number {
  const byte = bytes[index];
  if (byte === undefined || byte < 0x80 || byte > 0xbf) {
    throw new Error("invalid UTF-8 continuation byte");
  }
  return byte;
}

function unsafePhrasePattern(parts: readonly string[]): RegExp {
  return new RegExp(`\\b${parts.join("[\\s-]+")}\\b`, "iu");
}

const UNSAFE_PUBLIC_CLAIM_PATTERNS = [
  { id: "fire_approved", pattern: unsafePhrasePattern(["fire", "approved"]) },
  { id: "certified_safe", pattern: unsafePhrasePattern(["certified", "safe"]) },
  { id: "legally_compliant", pattern: unsafePhrasePattern(["legally", "compliant"]) },
  { id: "survey_grade", pattern: unsafePhrasePattern(["survey", "grade"]) },
  { id: "approved_for_occupancy", pattern: unsafePhrasePattern(["approved", "for", "occupancy"]) },
  { id: "guaranteed_accessible", pattern: unsafePhrasePattern(["guaranteed", "accessible"]) },
  { id: "black_label", pattern: unsafePhrasePattern(["Black", "Label"]) },
  { id: "production_ready", pattern: unsafePhrasePattern(["production", "ready"]) },
  { id: "photoreal_digital_twin", pattern: unsafePhrasePattern(["photoreal", "digital", "twin"]) },
] as const;
