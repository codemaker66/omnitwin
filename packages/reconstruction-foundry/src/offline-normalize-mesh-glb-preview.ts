import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import {
  DsseEnvelopeSchema,
  verifyDsseEnvelope,
  type TrustedDsseKeys,
} from "./dsse.js";
import { FoundryIntegrityError } from "./errors.js";
import { sha256Bytes } from "./hash.js";
import {
  FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
  FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY,
  FOUNDRY_NORMALIZE_MESH_GLB_SEMANTIC_SNAPSHOT_V0,
  normalizeMeshGlbPureTransformInternal,
  verifyNormalizeMeshGlbSemanticProofInternal,
} from "./normalize-mesh-glb-worker.js";

export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_INVOCATION_V0 =
  "omnitwin.foundry.offline-normalize-mesh-glb-preview-invocation.v0";
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_REPORT_V0 =
  "omnitwin.foundry.offline-normalize-mesh-glb-preview-report.v0";
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_V0 =
  "omnitwin.foundry.offline-normalize-mesh-glb-preview-permit.v0";
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0 =
  "omnitwin.foundry.offline-normalize-mesh-glb-preview-operator-acknowledgement.v0";
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE =
  "offline_private_authority_none_preview";
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE =
  "application/vnd.omnitwin.foundry.offline-normalize-mesh-glb-preview-permit.v0+json";
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_LIFETIME_SECONDS =
  15 * 60;
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_PAYLOAD_BYTES =
  64 * 1024;
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_STATEMENT =
  "I record my intent to create a private offline format-normalization preview for this exact source and operation. This acknowledgement is not a rights approval or execution permit.";

export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OUTPUT_POLICY_V0 =
  Object.freeze({
    disposition: "private_quarantine_only",
    persistence: "not_performed_by_pure_in_memory_primitive",
    releaseEligible: false,
    trainingEligible: false,
    redistributionEligible: false,
    signingEligible: false,
    registrationEligible: false,
    publicationEligible: false,
    promotionEligible: false,
    measurementEligible: false,
    authority: "none",
  } as const);

export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_BOUNDARY_V0 =
  Object.freeze({
    primitiveKind: "pure_in_memory",
    filesystemAccess: "none",
    networkAccess: "none",
    childProcesses: "none",
    sandboxEstablished: false,
    custodyEstablished: false,
    rightsAuthorizationEstablished: false,
    replayProtectionEstablished: false,
    sandboxStatement: "not_established_by_pure_in_memory_primitive",
    custodyStatement: "not_established_by_pure_in_memory_primitive",
    rightsAuthorizationStatement:
      "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive",
    replayProtectionStatement:
      "one_run_permit_consumption_requires_trusted_process_controller",
  } as const);

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/u;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u;
const UTC_INSTANT = z.string().datetime({ offset: true, precision: 3 });
const ACKNOWLEDGEMENT_DOMAIN =
  "OMNITWIN_FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_ACKNOWLEDGEMENT_V0";
const INVOCATION_DOMAIN =
  "OMNITWIN_FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_INVOCATION_V0";
const REPORT_DOMAIN =
  "OMNITWIN_FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_REPORT_V0";

function fail(code: string, message: string, cause?: unknown): never {
  throw new FoundryIntegrityError(code, message, { cause });
}

function digest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) ===
    stableCanonicalJson(toCanonicalJson(right));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
}

function issue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

const SourceSchema = z
  .object({
    assetId: z.string().regex(OPAQUE_ID),
    inputType: z.literal("glb_gltf"),
    mediaType: z.literal("model/gltf-binary"),
    sizeBytes: z
      .number()
      .int()
      .safe()
      .positive()
      .max(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES),
    sha256: z.string().regex(SHA256),
  })
  .strict();

const DecisionSourceSchema = SourceSchema.pick({
  assetId: true,
  sizeBytes: true,
  sha256: true,
});

const OperationSchema = z
  .object({
    operation: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION),
    operationVersion: z.literal(
      FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
    ),
    sealedIdentity: z.tuple([
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[0]),
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[1]),
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[2]),
    ]),
  })
  .strict();

const OutputPolicySchema = z
  .object({
    disposition: z.literal("private_quarantine_only"),
    persistence: z.literal("not_performed_by_pure_in_memory_primitive"),
    releaseEligible: z.literal(false),
    trainingEligible: z.literal(false),
    redistributionEligible: z.literal(false),
    signingEligible: z.literal(false),
    registrationEligible: z.literal(false),
    publicationEligible: z.literal(false),
    promotionEligible: z.literal(false),
    measurementEligible: z.literal(false),
    authority: z.literal("none"),
  })
  .strict();

const ExecutionBoundarySchema = z
  .object({
    primitiveKind: z.literal("pure_in_memory"),
    filesystemAccess: z.literal("none"),
    networkAccess: z.literal("none"),
    childProcesses: z.literal("none"),
    sandboxEstablished: z.literal(false),
    custodyEstablished: z.literal(false),
    rightsAuthorizationEstablished: z.literal(false),
    replayProtectionEstablished: z.literal(false),
    sandboxStatement: z.literal(
      "not_established_by_pure_in_memory_primitive",
    ),
    custodyStatement: z.literal(
      "not_established_by_pure_in_memory_primitive",
    ),
    rightsAuthorizationStatement: z.literal(
      "not_established_by_operator_acknowledgement_or_pure_in_memory_primitive",
    ),
    replayProtectionStatement: z.literal(
      "one_run_permit_consumption_requires_trusted_process_controller",
    ),
  })
  .strict();

export const FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_V0,
    ),
    permitId: z.string().regex(OPAQUE_ID),
    issuerKeyId: z.string().regex(KEY_ID),
    validFrom: UTC_INSTANT,
    expiresAt: UTC_INSTANT,
    purpose: z.literal("private_offline_format_normalization_preview"),
    actions: z.tuple([
      z.literal("normalize_mesh_glb_to_private_preview_bytes"),
    ]),
    source: SourceSchema,
    operation: OperationSchema,
    outputPolicy: OutputPolicySchema,
    executionBoundary: ExecutionBoundarySchema,
    permitScope: z.literal("trusted_process_side_offline_preview_only"),
    outputAuthority: z.literal("none"),
  })
  .strict()
  .superRefine((permit, ctx) => {
    const validFrom = Date.parse(permit.validFrom);
    const expiresAt = Date.parse(permit.expiresAt);
    if (expiresAt <= validFrom) {
      issue(
        ctx,
        ["expiresAt"],
        "offline preview permit must expire after its inclusive validity start",
      );
      return;
    }
    if (
      expiresAt - validFrom >
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_LIFETIME_SECONDS *
        1_000
    ) {
      issue(
        ctx,
        ["expiresAt"],
        "offline preview permit exceeds the immutable short-lived lifetime bound",
      );
    }
  });

export type FoundryOfflineNormalizeMeshGlbPreviewPermitV0 = z.infer<
  typeof FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema
>;

export function serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0(
  input: unknown,
): Buffer {
  const permit =
    FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema.parse(input);
  return Buffer.from(stableCanonicalJson(toCanonicalJson(permit)), "utf8");
}

const OperatorAcknowledgementPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0,
    ),
    acknowledgementId: z.string().regex(OPAQUE_ID),
    operatorId: z.string().regex(OPAQUE_ID),
    recordedAt: UTC_INSTANT,
    acknowledgement: z.literal(
      "operator_records_private_offline_preview_intent",
    ),
    statement: z.literal(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_STATEMENT,
    ),
    legalPosture: z.literal(
      "operator_statement_not_independent_rights_approval",
    ),
    authorizationPosture: z.literal(
      "operator_statement_recorded_not_a_permit",
    ),
    independentRightsApprovalEstablished: z.literal(false),
    operatorStatementEstablishesExecutionPermit: z.literal(false),
    source: DecisionSourceSchema,
    operation: OperationSchema,
    authority: z.literal("none"),
  })
  .strict();

export const FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0Schema =
  OperatorAcknowledgementPayloadSchema.extend({
    acknowledgementSha256: z.string().regex(SHA256),
  })
    .strict()
    .superRefine((acknowledgement, ctx) => {
      const { acknowledgementSha256: _acknowledgementSha256, ...payload } =
        acknowledgement;
      const parsed = OperatorAcknowledgementPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        for (const entry of parsed.error.issues) ctx.addIssue(entry);
        return;
      }
      if (
        acknowledgement.acknowledgementSha256 !==
        computeFoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementSha256(
          parsed.data,
        )
      ) {
        issue(
          ctx,
          ["acknowledgementSha256"],
          "operator acknowledgement digest mismatch",
        );
      }
    });

export type FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0 =
  z.infer<
    typeof FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0Schema
  >;

export function computeFoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementSha256(
  input: unknown,
): string {
  return digest(
    ACKNOWLEDGEMENT_DOMAIN,
    OperatorAcknowledgementPayloadSchema.parse(input),
  );
}

const PermitBindingSchema = z
  .object({
    payloadSha256: z.string().regex(SHA256),
    keyId: z.string().regex(KEY_ID),
    expiresAt: UTC_INSTANT,
  })
  .strict();

export const FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_INVOCATION_V0,
    ),
    operation: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION),
    operationVersion: z.literal(
      FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
    ),
    sealedIdentity: z.tuple([
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[0]),
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[1]),
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[2]),
    ]),
    executionMode: z.literal(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
    ),
    source: SourceSchema,
    permit: PermitBindingSchema,
    operatorAcknowledgement:
      FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0Schema,
    operatorAcknowledgementSha256: z.string().regex(SHA256),
    outputPolicy: OutputPolicySchema,
    executionBoundary: ExecutionBoundarySchema,
    authority: z.literal("none"),
  })
  .strict()
  .superRefine((invocation, ctx) => {
    const acknowledgement = invocation.operatorAcknowledgement;
    if (
      invocation.operatorAcknowledgementSha256 !==
      acknowledgement.acknowledgementSha256
    ) {
      issue(
        ctx,
        ["operatorAcknowledgementSha256"],
        "operator acknowledgement digest binding mismatch",
      );
    }
    if (
      !sameCanonical(acknowledgement.source, {
        assetId: invocation.source.assetId,
        sizeBytes: invocation.source.sizeBytes,
        sha256: invocation.source.sha256,
      }) ||
      !sameCanonical(acknowledgement.operation, {
        operation: invocation.operation,
        operationVersion: invocation.operationVersion,
        sealedIdentity: invocation.sealedIdentity,
      })
    ) {
      issue(
        ctx,
        ["operatorAcknowledgement"],
        "operator acknowledgement must exactly bind the invocation source and operation",
      );
    }
  });

export type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0 = z.infer<
  typeof FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema
>;

export function computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256(
  input: unknown,
): string {
  return digest(
    INVOCATION_DOMAIN,
    FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse(input),
  );
}

const ValidatorResultSchema = z
  .object({
    version: z.string().min(1),
    errors: z.literal(0),
    warnings: z.literal(0),
  })
  .strict();

const LIMITATIONS = [
  "This result is an authority-none private offline format-normalization preview only.",
  "The operator acknowledgement records intent only; it is neither an execution permit nor an independent rights approval.",
  "Execution requires a separate trusted, short-lived, exact-source and exact-operation process-side DSSE permit.",
  "The process-side permit authorizes only this pure preview transform and grants no training, redistribution, signing, registration, publication, promotion, measurement, or release capability.",
  "This pure in-memory primitive establishes no operating-system sandbox, filesystem custody, or rights authorization.",
  "Exact decoded geometry equality proves format normalization only; it does not establish measurement fitness, reconstruction quality, or real-world accuracy.",
  "This report contains no trusted execution or completion timestamp; its canonical digest is not a signature or historical proof that execution completed inside the permit window.",
  "This pure primitive verifies but does not consume permits; a trusted process controller must atomically enforce one run per permit payload digest.",
] as const;

const ReportPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_REPORT_V0,
    ),
    invocationSha256: z.string().regex(SHA256),
    executionMode: z.literal(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
    ),
    operation: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION),
    operationVersion: z.literal(
      FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
    ),
    source: SourceSchema,
    permit: PermitBindingSchema,
    operatorAcknowledgementSha256: z.string().regex(SHA256),
    output: z
      .object({
        mediaType: z.literal("model/gltf-binary"),
        sizeBytes: z
          .number()
          .int()
          .safe()
          .positive()
          .max(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES),
        sha256: z.string().regex(SHA256),
      })
      .strict(),
    semanticProof: z
      .object({
        schemaVersion: z.literal(
          FOUNDRY_NORMALIZE_MESH_GLB_SEMANTIC_SNAPSHOT_V0,
        ),
        beforeSha256: z.string().regex(SHA256),
        afterSha256: z.string().regex(SHA256),
        exactMatch: z.literal(true),
        accessorCount: z.number().int().positive(),
        compressedBufferViewCount: z.number().int().positive(),
      })
      .strict(),
    validation: z
      .object({ before: ValidatorResultSchema, after: ValidatorResultSchema })
      .strict(),
    transform: z
      .object({
        sealedIdentity: z.tuple([
          z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[0]),
          z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[1]),
          z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[2]),
        ]),
        extension: z.literal("EXT_meshopt_compression"),
        required: z.literal(true),
        encoderMethod: z.literal("quantize"),
        meshoptFilter: z.literal("NONE"),
        logicalAccessorMutation: z.literal(
          "none_proven_by_exact_decoded_snapshot",
        ),
      })
      .strict(),
    outputPolicy: OutputPolicySchema,
    executionBoundary: ExecutionBoundarySchema,
    limitations: z.tuple([
      z.literal(LIMITATIONS[0]),
      z.literal(LIMITATIONS[1]),
      z.literal(LIMITATIONS[2]),
      z.literal(LIMITATIONS[3]),
      z.literal(LIMITATIONS[4]),
      z.literal(LIMITATIONS[5]),
      z.literal(LIMITATIONS[6]),
      z.literal(LIMITATIONS[7]),
    ]),
    authority: z.literal("none"),
  })
  .strict();

export const FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema =
  ReportPayloadSchema.extend({ reportSha256: z.string().regex(SHA256) })
    .strict()
    .superRefine((report, ctx) => {
      const { reportSha256: _reportSha256, ...payload } = report;
      const parsed = ReportPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        for (const entry of parsed.error.issues) ctx.addIssue(entry);
        return;
      }
      if (
        report.reportSha256 !==
        computeFoundryOfflineNormalizeMeshGlbPreviewReportSha256(parsed.data)
      ) {
        issue(ctx, ["reportSha256"], "offline preview report digest mismatch");
      }
    });

export type FoundryOfflineNormalizeMeshGlbPreviewReportV0 = z.infer<
  typeof FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema
>;

export function computeFoundryOfflineNormalizeMeshGlbPreviewReportSha256(
  input: unknown,
): string {
  return digest(REPORT_DOMAIN, ReportPayloadSchema.parse(input));
}

export interface RunFoundryOfflineNormalizeMeshGlbPreviewOptions {
  readonly invocation: unknown;
  readonly sourceBytes: Uint8Array;
  /** Controller-provisioned evidence only; never accept this envelope from browser input. */
  readonly permitEnvelope: unknown;
  /**
   * Preview-specific pinned Ed25519 public keys owned by the trusted process.
   * Supplying a browser/user-provided keyring would destroy the permit boundary.
   */
  readonly pinnedTrustedPermitKeys: TrustedDsseKeys;
}

export interface FoundryOfflineNormalizeMeshGlbPreviewResult {
  readonly normalizedGlb: Buffer;
  readonly report: FoundryOfflineNormalizeMeshGlbPreviewReportV0;
}

function parseCanonicalPermitBytes(bytes: Uint8Array): {
  readonly permit: FoundryOfflineNormalizeMeshGlbPreviewPermitV0;
  readonly canonicalBytes: Buffer;
} {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_ENCODING_INVALID",
      "Offline preview permit payload is not valid UTF-8.",
      error,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error: unknown) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_JSON_INVALID",
      "Offline preview permit payload is not valid JSON.",
      error,
    );
  }
  let permit: FoundryOfflineNormalizeMeshGlbPreviewPermitV0;
  try {
    permit = FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema.parse(raw);
  } catch (error: unknown) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_CLAIMS_INVALID",
      "Signed offline preview permit claims do not match the immutable preview contract.",
      error,
    );
  }
  const canonicalBytes =
    serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0(permit);
  if (!Buffer.from(bytes).equals(canonicalBytes)) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_NOT_CANONICAL",
      "Offline preview permit payload bytes are not the exact canonical JSON encoding.",
    );
  }
  return { permit, canonicalBytes };
}

function parseExactPermitEnvelope(envelopeInput: unknown) {
  if (
    typeof envelopeInput !== "object" ||
    envelopeInput === null ||
    Array.isArray(envelopeInput)
  ) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_ENVELOPE_INVALID",
      "Offline preview permit envelope must be an exact object.",
    );
  }
  const raw = envelopeInput as Record<string, unknown>;
  if (
    raw.payloadType !==
    FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE
  ) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE_MISMATCH",
      "Offline preview permit envelope payload type must match exactly without trimming.",
    );
  }
  if (
    typeof raw.payload !== "string" ||
    raw.payload.length >
      Math.ceil(
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_PAYLOAD_BYTES /
          3,
      ) *
        4
  ) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TOO_LARGE",
      "Offline preview permit payload exceeds the immutable byte budget before decoding.",
    );
  }
  if (!Array.isArray(raw.signatures)) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_ENVELOPE_INVALID",
      "Offline preview permit envelope signatures must be an array.",
    );
  }
  for (const signature of raw.signatures) {
    if (
      typeof signature !== "object" ||
      signature === null ||
      Array.isArray(signature)
    ) {
      fail(
        "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_KEY_ID_INVALID",
        "Offline preview permit signature key IDs must use their exact opaque spelling without trimming.",
      );
    }
    const keyId = (signature as Record<string, unknown>).keyid;
    if (typeof keyId !== "string" || !KEY_ID.test(keyId)) {
      fail(
        "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_KEY_ID_INVALID",
        "Offline preview permit signature key IDs must use their exact opaque spelling without trimming.",
      );
    }
  }
  return DsseEnvelopeSchema.parse(envelopeInput);
}

function assertPermitActive(
  permit: { readonly validFrom: string; readonly expiresAt: string },
): void {
  const now = Date.now();
  if (now < Date.parse(permit.validFrom)) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_NOT_YET_VALID",
      "Trusted offline preview permit has not reached its inclusive validity start.",
    );
  }
  if (now >= Date.parse(permit.expiresAt)) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_EXPIRED",
      "Trusted offline preview permit has reached its exclusive expiry.",
    );
  }
}

function verifyPermit(
  invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  envelopeInput: unknown,
  trustedKeys: TrustedDsseKeys,
): FoundryOfflineNormalizeMeshGlbPreviewPermitV0 {
  const envelope = parseExactPermitEnvelope(envelopeInput);
  const payloadBytes = Buffer.from(envelope.payload, "base64");
  if (
    payloadBytes.length >
    FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_PAYLOAD_BYTES
  ) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TOO_LARGE",
      "Offline preview permit payload exceeds the immutable decoded byte budget.",
    );
  }
  const payloadSha256 = sha256Bytes(payloadBytes);
  if (invocation.permit.payloadSha256 !== `sha256:${payloadSha256}`) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_BINDING_MISMATCH",
      "Signed offline preview permit bytes do not match the invocation permit digest.",
    );
  }
  const verified = verifyDsseEnvelope(envelope, trustedKeys, {
    payloadType:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
    payloadSha256,
  });
  if (!verified.verifiedKeyIds.includes(invocation.permit.keyId)) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_KEY_MISMATCH",
      "The invocation-bound permit key ID did not produce a trusted Ed25519 signature.",
    );
  }
  const { permit } = parseCanonicalPermitBytes(verified.payload);
  if (
    permit.issuerKeyId !== invocation.permit.keyId ||
    permit.expiresAt !== invocation.permit.expiresAt ||
    !sameCanonical(permit.source, invocation.source) ||
    !sameCanonical(permit.operation, {
      operation: invocation.operation,
      operationVersion: invocation.operationVersion,
      sealedIdentity: invocation.sealedIdentity,
    }) ||
    !sameCanonical(permit.outputPolicy, invocation.outputPolicy) ||
    !sameCanonical(permit.executionBoundary, invocation.executionBoundary)
  ) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_BINDING_MISMATCH",
      "Trusted offline preview permit does not exactly bind the invocation source, operation, expiry, and restrictions.",
    );
  }
  assertPermitActive(permit);
  return permit;
}

export interface VerifyFoundryOfflineNormalizeMeshGlbPreviewPermitOptions {
  readonly invocation: unknown;
  /** Controller-provisioned evidence only; never accept this envelope from browser input. */
  readonly permitEnvelope: unknown;
  /** Preview-specific pinned Ed25519 public keys owned by the trusted process. */
  readonly pinnedTrustedPermitKeys: TrustedDsseKeys;
}

export interface FoundryOfflineNormalizeMeshGlbPreviewVerifiedPermit {
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly permitPayloadSha256: string;
  readonly validFrom: string;
  readonly expiresAt: string;
}

/**
 * Synchronously verifies only the signed permit boundary. It performs no
 * source-byte access and no transform. The returned frozen DTO intentionally
 * omits the raw envelope, trusted keys, and every non-controller permit claim.
 */
export function verifyFoundryOfflineNormalizeMeshGlbPreviewPermit(
  options: VerifyFoundryOfflineNormalizeMeshGlbPreviewPermitOptions,
): FoundryOfflineNormalizeMeshGlbPreviewVerifiedPermit {
  const invocation =
    FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse(
      options.invocation,
    );
  const permit = verifyPermit(
    invocation,
    options.permitEnvelope,
    options.pinnedTrustedPermitKeys,
  );
  return deepFreeze({
    invocation,
    permitPayloadSha256: invocation.permit.payloadSha256,
    validFrom: permit.validFrom,
    expiresAt: permit.expiresAt,
  });
}

function buildPreviewResult(
  invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  transform: Awaited<
    ReturnType<typeof normalizeMeshGlbPureTransformInternal>
  >,
): FoundryOfflineNormalizeMeshGlbPreviewResult {
  const payload = ReportPayloadSchema.parse({
    schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_REPORT_V0,
    invocationSha256:
      computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256(invocation),
    executionMode: invocation.executionMode,
    operation: invocation.operation,
    operationVersion: invocation.operationVersion,
    source: invocation.source,
    permit: invocation.permit,
    operatorAcknowledgementSha256:
      invocation.operatorAcknowledgementSha256,
    output: {
      mediaType: "model/gltf-binary",
      sizeBytes: transform.normalizedGlb.length,
      sha256: `sha256:${sha256Bytes(transform.normalizedGlb)}`,
    },
    semanticProof: transform.semanticProof,
    validation: transform.validation,
    transform: {
      sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
      extension: "EXT_meshopt_compression",
      required: true,
      encoderMethod: "quantize",
      meshoptFilter: "NONE",
      logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot",
    },
    outputPolicy: invocation.outputPolicy,
    executionBoundary: invocation.executionBoundary,
    limitations: LIMITATIONS,
    authority: "none",
  });
  const report = FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.parse({
    ...payload,
    reportSha256:
      computeFoundryOfflineNormalizeMeshGlbPreviewReportSha256(payload),
  });
  return { normalizedGlb: transform.normalizedGlb, report };
}

/**
 * Runs only the in-memory transform after cryptographic permit verification.
 * This stateless primitive neither issues nor consumes a permit. A trusted
 * process controller must pin the keyring, keep evidence out of browser input,
 * atomically enforce one run per permit digest, and discard late results.
 */
export async function runFoundryOfflineNormalizeMeshGlbPreview(
  options: RunFoundryOfflineNormalizeMeshGlbPreviewOptions,
): Promise<FoundryOfflineNormalizeMeshGlbPreviewResult> {
  const verifiedPermit = verifyFoundryOfflineNormalizeMeshGlbPreviewPermit({
    invocation: options.invocation,
    permitEnvelope: options.permitEnvelope,
    pinnedTrustedPermitKeys: options.pinnedTrustedPermitKeys,
  });
  const invocation = verifiedPermit.invocation;
  const transform = await normalizeMeshGlbPureTransformInternal(
    invocation.source,
    options.sourceBytes,
  );
  assertPermitActive(verifiedPermit);
  return buildPreviewResult(invocation, transform);
}

export interface VerifyFoundryOfflineNormalizeMeshGlbPreviewOptions
  extends RunFoundryOfflineNormalizeMeshGlbPreviewOptions {
  readonly normalizedGlb: Uint8Array;
  readonly report: unknown;
}

export async function verifyFoundryOfflineNormalizeMeshGlbPreview(
  options: VerifyFoundryOfflineNormalizeMeshGlbPreviewOptions,
): Promise<void> {
  const verifiedPermit = verifyFoundryOfflineNormalizeMeshGlbPreviewPermit({
    invocation: options.invocation,
    permitEnvelope: options.permitEnvelope,
    pinnedTrustedPermitKeys: options.pinnedTrustedPermitKeys,
  });
  const invocation = verifiedPermit.invocation;
  const report = FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.parse(
    options.report,
  );
  if (
    options.sourceBytes.byteLength <= 0 ||
    options.sourceBytes.byteLength > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES ||
    options.normalizedGlb.byteLength <= 0 ||
    options.normalizedGlb.byteLength > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES ||
    options.sourceBytes.byteLength !== invocation.source.sizeBytes ||
    options.sourceBytes.byteLength !== report.source.sizeBytes ||
    options.normalizedGlb.byteLength !== report.output.sizeBytes
  ) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PROOF_BINDING_MISMATCH",
      "Offline preview proof byte lengths exceed bounds or differ from their exact bindings.",
    );
  }
  const source = Buffer.from(options.sourceBytes);
  const normalized = Buffer.from(options.normalizedGlb);
  if (
    report.invocationSha256 !==
      computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256(
        invocation,
      ) ||
    !sameCanonical(report.source, invocation.source) ||
    !sameCanonical(report.permit, invocation.permit) ||
    report.operatorAcknowledgementSha256 !==
      invocation.operatorAcknowledgementSha256 ||
    !sameCanonical(report.outputPolicy, invocation.outputPolicy) ||
    !sameCanonical(report.executionBoundary, invocation.executionBoundary) ||
    invocation.source.sha256 !== `sha256:${sha256Bytes(source)}` ||
    report.source.sha256 !== `sha256:${sha256Bytes(source)}` ||
    report.output.sha256 !== `sha256:${sha256Bytes(normalized)}`
  ) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PROOF_BINDING_MISMATCH",
      "Offline preview proof bytes, permit, acknowledgement, or invocation bindings do not match.",
    );
  }
  await verifyNormalizeMeshGlbSemanticProofInternal({
    sourceBytes: source,
    normalizedGlb: normalized,
    semanticProof: report.semanticProof,
    validation: report.validation,
  });
  const expectedTransform = await normalizeMeshGlbPureTransformInternal(
    invocation.source,
    source,
  );
  assertPermitActive(verifiedPermit);
  const expected = buildPreviewResult(invocation, expectedTransform);
  if (
    !normalized.equals(expected.normalizedGlb) ||
    !sameCanonical(report, expected.report)
  ) {
    fail(
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_DETERMINISTIC_PROVENANCE_MISMATCH",
      "Offline preview bytes or report do not exactly reproduce the pinned deterministic transform.",
    );
  }
}
