import { createHash } from "node:crypto";

import {
  domainSeparatedSha256,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME = "review-pack-v3.json";
export const GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME =
  "human-decisions-v3.json";
export const GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME =
  "closed-selection-volume-review-template-v3.json";
export const GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME =
  "publication-receipt-v3.json";
export const GRAND_HALL_T554_V3_RECEIPT_SCHEMA =
  "omnitwin.foundry.grand-hall-t554-human-pending-review-pack-receipt.v3";
export const GRAND_HALL_T554_V3_TEST_RECEIPT_SCHEMA =
  "omnitwin.foundry.grand-hall-t554-review-pack-receipt.test-only.v1";

export const GRAND_HALL_T554_V3_RECEIPT_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_HUMAN_PENDING_REVIEW_PACK_RECEIPT_V3";
export const GRAND_HALL_T554_V3_TEST_RECEIPT_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_REVIEW_PACK_RECEIPT_TEST_ONLY_V1";
export const GRAND_HALL_T554_V3_MAX_JSON_BYTES = 16 * 1_024 * 1_024;

export type GrandHallT554V3Sha256 = `sha256:${string}`;

const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u)
  .transform((value): GrandHallT554V3Sha256 => value as GrandHallT554V3Sha256);
const ByteLengthSchema = z.number().int().positive()
  .max(GRAND_HALL_T554_V3_MAX_JSON_BYTES);
const PayloadNameSchema = z.enum([
  GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
  GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
  GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
]);

const PayloadSchema = z.object({
  relativePath: PayloadNameSchema,
  byteLength: ByteLengthSchema,
  sha256: Sha256Schema,
}).strict();

const SourceBindingsSchema = z.object({
  predecessorReviewPackArtifactSha256: Sha256Schema,
  predecessorReviewPackFileSha256: Sha256Schema,
  predecessorReviewPackFileByteLength: ByteLengthSchema,
  t561ObservationInputFileSha256: Sha256Schema,
  t561ObservationInputFileByteLength: ByteLengthSchema,
  t561ObservationSetSha256: Sha256Schema,
  t561ManifestSha256: Sha256Schema,
  t561ManifestFileSha256: Sha256Schema,
  t561ManifestFileByteLength: ByteLengthSchema,
  t561ReceiptSha256: Sha256Schema,
  t561ReceiptFileSha256: Sha256Schema,
  t561ReceiptFileByteLength: ByteLengthSchema,
  t551SourceEvidenceSha256: Sha256Schema,
  cleanupMarkerEvidenceSha256: Sha256Schema,
  cleanupTargetInventorySha256: Sha256Schema,
  cleanupEvidenceFileSha256: Sha256Schema,
  cleanupEvidenceFileByteLength: ByteLengthSchema,
  cleanupReceiptSha256: Sha256Schema,
  cleanupReceiptFileSha256: Sha256Schema,
  cleanupReceiptFileByteLength: ByteLengthSchema,
}).strict();

const GuardsSchema = z.object({
  humanAcceptanceRecorded: z.literal(false),
  nativeResolutionHumanReviewCompleted: z.literal(false),
  masksAuthored: z.literal(false),
  cleanupAuthority: z.literal("none"),
  roomMembershipAuthority: z.literal("none"),
  interfaceAuthority: z.literal("none"),
  closedVolumeAuthority: z.literal("none"),
  trainingAuthorized: z.literal(false),
  reconstructionAuthorized: z.literal(false),
  runtimeAuthorized: z.literal(false),
  generatedContentAuthorized: z.literal(false),
  publicEvidenceAuthorized: z.literal(false),
}).strict();

const ExactSourceChecksSchema = z.object({
  t561ExactRegenerationVerified: z.literal(true),
  cleanupExactRegenerationVerified: z.literal(true),
}).strict();

function lexicalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function refinePayloadInventory(
  receipt: { readonly payloads: readonly z.infer<typeof PayloadSchema>[] },
  context: z.RefinementCtx,
): void {
  const expected = PayloadNameSchema.options.slice().sort(lexicalOrder);
  const actual = receipt.payloads.map((payload) => payload.relativePath);
  if (actual.join("\n") !== expected.join("\n")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payloads"],
      message: "V3 receipt payloads must cover all three exact files in canonical order.",
    });
  }
}

export const GrandHallT554ReviewPackV3ReceiptMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_T554_V3_RECEIPT_SCHEMA),
  state: z.literal("complete_human_pending"),
  authority: z.literal("none"),
  exactSourceChecks: ExactSourceChecksSchema,
  sourceBindings: SourceBindingsSchema,
  reviewPackSha256: Sha256Schema,
  humanDecisionsSha256: Sha256Schema,
  closedVolumeReviewSha256: Sha256Schema,
  payloadFileCount: z.literal(3),
  outputFileCount: z.literal(4),
  payloads: z.array(PayloadSchema).length(3),
  guards: GuardsSchema,
  receiptWrittenLast: z.literal(true),
}).strict().superRefine(refinePayloadInventory);

export type GrandHallT554ReviewPackV3ReceiptMaterial = z.infer<
  typeof GrandHallT554ReviewPackV3ReceiptMaterialSchema
>;

export const GrandHallT554ReviewPackV3ReceiptSchema =
  GrandHallT554ReviewPackV3ReceiptMaterialSchema.innerType().extend({
    receiptSha256: Sha256Schema,
  }).strict().superRefine(refinePayloadInventory);

export type GrandHallT554ReviewPackV3Receipt = z.infer<
  typeof GrandHallT554ReviewPackV3ReceiptSchema
>;

const TestReceiptCommonSchema = GrandHallT554ReviewPackV3ReceiptMaterialSchema
  .innerType().omit({ schemaVersion: true, state: true, exactSourceChecks: true });

export const GrandHallT554ReviewPackV3TestReceiptMaterialSchema =
  TestReceiptCommonSchema.extend({
    schemaVersion: z.literal(GRAND_HALL_T554_V3_TEST_RECEIPT_SCHEMA),
    state: z.literal("structural_test_only"),
    exactSourceChecks: z.object({
      t561ExactRegenerationVerified: z.literal(false),
      cleanupExactRegenerationVerified: z.literal(false),
    }).strict(),
  }).strict().superRefine(refinePayloadInventory);

export type GrandHallT554ReviewPackV3TestReceiptMaterial = z.infer<
  typeof GrandHallT554ReviewPackV3TestReceiptMaterialSchema
>;

export const GrandHallT554ReviewPackV3TestReceiptSchema =
  GrandHallT554ReviewPackV3TestReceiptMaterialSchema.innerType().extend({
    receiptSha256: Sha256Schema,
  }).strict().superRefine(refinePayloadInventory);

export type GrandHallT554ReviewPackV3TestReceipt = z.infer<
  typeof GrandHallT554ReviewPackV3TestReceiptSchema
>;

export class GrandHallT554ReviewPackV3Error extends Error {
  public constructor(
    public readonly code:
      | "ARGUMENT_INVALID"
      | "SOURCE_INVALID"
      | "OUTPUT_UNSAFE"
      | "OUTPUT_PUBLISH_FAILED"
      | "OUTPUT_VERIFICATION_FAILED",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554ReviewPackV3Error";
  }
}

export function grandHallT554V3FileSha256(bytes: Buffer): GrandHallT554V3Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function serializeGrandHallT554V3Json(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function receiptDigest(
  domain: string,
  material: unknown,
): GrandHallT554V3Sha256 {
  return `sha256:${domainSeparatedSha256(
    domain, toCanonicalJson(material),
  )}`;
}

export function sealGrandHallT554ReviewPackV3Receipt(
  input: unknown,
): GrandHallT554ReviewPackV3Receipt {
  const material = GrandHallT554ReviewPackV3ReceiptMaterialSchema.parse(input);
  return GrandHallT554ReviewPackV3ReceiptSchema.parse({
    ...material,
    receiptSha256: receiptDigest(GRAND_HALL_T554_V3_RECEIPT_DOMAIN, material),
  });
}

export function parseGrandHallT554ReviewPackV3Receipt(
  bytes: Buffer,
): GrandHallT554ReviewPackV3Receipt {
  try {
    const receipt = GrandHallT554ReviewPackV3ReceiptSchema.parse(
      parseGrandHallT554StrictJson(bytes),
    );
    const { receiptSha256, ...materialInput } = receipt;
    const material = GrandHallT554ReviewPackV3ReceiptMaterialSchema.parse(materialInput);
    if (receiptSha256 !== receiptDigest(GRAND_HALL_T554_V3_RECEIPT_DOMAIN, material)) {
      throw new Error("V3 publication receipt self-digest mismatch.");
    }
    return receipt;
  } catch (error) {
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted T-554 v3 publication receipt is invalid.",
      error,
    );
  }
}

export function sealGrandHallT554ReviewPackV3TestReceipt(
  input: unknown,
): GrandHallT554ReviewPackV3TestReceipt {
  const material = GrandHallT554ReviewPackV3TestReceiptMaterialSchema.parse(input);
  return GrandHallT554ReviewPackV3TestReceiptSchema.parse({ ...material,
    receiptSha256: receiptDigest(GRAND_HALL_T554_V3_TEST_RECEIPT_DOMAIN,
      material) });
}

export function parseGrandHallT554ReviewPackV3TestReceipt(
  bytes: Buffer,
): GrandHallT554ReviewPackV3TestReceipt {
  try {
    const receipt = GrandHallT554ReviewPackV3TestReceiptSchema.parse(
      parseGrandHallT554StrictJson(bytes),
    );
    const { receiptSha256, ...materialInput } = receipt;
    const material = GrandHallT554ReviewPackV3TestReceiptMaterialSchema.parse(materialInput);
    if (receiptSha256 !== receiptDigest(GRAND_HALL_T554_V3_TEST_RECEIPT_DOMAIN,
      material)) throw new Error(
      "Test-only V3 receipt self-digest mismatch.",
    );
    return receipt;
  } catch (error) {
    throw new GrandHallT554ReviewPackV3Error(
      "OUTPUT_VERIFICATION_FAILED", "Persisted test-only V3 receipt is invalid.", error,
    );
  }
}
