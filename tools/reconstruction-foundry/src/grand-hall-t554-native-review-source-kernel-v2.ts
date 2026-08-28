import { createHash } from "node:crypto";

import {
  CanonicalJsonValueSchema,
  GrandHallPanoramaSourceJpgIdentityV2Schema,
  stableCanonicalJson,
} from "@omnitwin/types";
import { z } from "zod";

import {
  GrandHallT554NativeReviewImplementationManifestBindingV2Schema,
  GrandHallT554NativeReviewRegistryBindingV2Schema,
  GrandHallT554NativeReviewSourceScopeV2Schema,
  GrandHallT554NativeReviewSourceVerificationV2Schema,
  type GrandHallT554NativeReviewSourceScopeV2,
} from "./grand-hall-t554-native-review-events-v2.js";
import {
  GrandHallT554NativeReviewSourceCoverageObservationInputV2Schema,
  planGrandHallT554NativeReviewNextSourceCoverageEventV2 as planReplayNextSourceCoverageEventV2,
  type GrandHallT554NativeReviewPlannedSourceCoverageEventV2,
} from "./grand-hall-t554-native-review-replay-v2.js";

export {
  GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_COVERAGE_OBSERVATION_INPUT_V2,
  GrandHallT554NativeReviewSourceCoverageObservationInputV2Schema,
  type GrandHallT554NativeReviewPlannedSourceCoverageEventV2,
  type GrandHallT554NativeReviewSourceCoverageObservationInputV2,
} from "./grand-hall-t554-native-review-replay-v2.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_SUBJECT_MATERIAL_V2 =
  "venviewer.grand-hall-t554-native-source-review-subject-material.v2";

const SOURCE_SUBJECT_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_SOURCE_REVIEW_SUBJECT_V2";

type Sha256 = `sha256:${string}`;

function addIssue(
  context: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

/**
 * The stable source-review trust boundary. Epoch, generation, authority, and
 * session bindings are intentionally absent so an identical admitted source
 * subject survives a resume without weakening its reviewed implementation.
 */
export const GrandHallT554NativeReviewSourceSubjectMaterialV2Schema = z
  .object({
    schemaVersion: z.literal(
      GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_SUBJECT_MATERIAL_V2,
    ),
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    sourceVerification: GrandHallT554NativeReviewSourceVerificationV2Schema,
    registry: GrandHallT554NativeReviewRegistryBindingV2Schema,
    implementationManifest:
      GrandHallT554NativeReviewImplementationManifestBindingV2Schema,
  })
  .strict()
  .superRefine((material, context) => {
    if (material.source.fileName !== material.sourceVerification.fileName) {
      addIssue(
        context,
        ["sourceVerification", "fileName"],
        "verification filename must match the exact admitted source",
      );
    }
    if (material.source.sha256 !== material.sourceVerification.sha256) {
      addIssue(
        context,
        ["sourceVerification", "sha256"],
        "verification digest must match the exact admitted source",
      );
    }
    if (
      material.source.byteLength !== material.sourceVerification.byteLength
    ) {
      addIssue(
        context,
        ["sourceVerification", "byteLength"],
        "verification length must match the exact admitted source",
      );
    }
  });

export type GrandHallT554NativeReviewSourceSubjectMaterialV2 = z.infer<
  typeof GrandHallT554NativeReviewSourceSubjectMaterialV2Schema
>;

const NextSourceCoverageEventPlannerInputV2Schema = z
  .object({
    scope: GrandHallT554NativeReviewSourceScopeV2Schema,
    events: z.array(z.unknown()),
    observation:
      GrandHallT554NativeReviewSourceCoverageObservationInputV2Schema,
  })
  .strict();

export class GrandHallT554NativeReviewSourceKernelV2Error extends Error {
  constructor(
    readonly code: "ARGUMENT_INVALID" | "SOURCE_SUBJECT_MISMATCH",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewSourceKernelV2Error";
  }
}

function fail(
  code: GrandHallT554NativeReviewSourceKernelV2Error["code"],
  message: string,
  cause?: unknown,
): GrandHallT554NativeReviewSourceKernelV2Error {
  return new GrandHallT554NativeReviewSourceKernelV2Error(
    code,
    message,
    cause,
  );
}

function canonicalDigest(domain: string, value: unknown): Sha256 {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableCanonicalJson(canonical)}`, "utf8")
    .digest("hex")}`;
}

export function computeGrandHallT554NativeReviewSourceSubjectV2Sha256(
  input: unknown,
): Sha256 {
  const parsed =
    GrandHallT554NativeReviewSourceSubjectMaterialV2Schema.safeParse(input);
  if (!parsed.success) {
    throw fail(
      "ARGUMENT_INVALID",
      "The source-review subject material is not the exact stable v2 trust boundary.",
      parsed.error,
    );
  }
  return canonicalDigest(SOURCE_SUBJECT_DIGEST_DOMAIN, parsed.data);
}

export const computeGrandHallT554NativeReviewSourceReviewSubjectV2Sha256 =
  computeGrandHallT554NativeReviewSourceSubjectV2Sha256;

function expectedSourceSubject(
  scope: GrandHallT554NativeReviewSourceScopeV2,
): Sha256 {
  return computeGrandHallT554NativeReviewSourceSubjectV2Sha256({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_SUBJECT_MATERIAL_V2,
    source: scope.sourceCustody.source,
    sourceVerification: scope.sourceCustody.sourceVerification,
    registry: scope.registry,
    implementationManifest: scope.implementationManifest,
  });
}

/**
 * Enforces the canonical stable subject, then delegates all sequence,
 * predecessor, binding, and coverage-witness hydration to the replay engine.
 * The planned event remains authority-none until durably appended and replayed.
 */
export function planGrandHallT554NativeReviewNextSourceCoverageEventV2(
  input: unknown,
): GrandHallT554NativeReviewPlannedSourceCoverageEventV2 {
  const parsed = NextSourceCoverageEventPlannerInputV2Schema.safeParse(input);
  if (!parsed.success) {
    throw fail(
      "ARGUMENT_INVALID",
      "The next source-coverage planner input is not the exact bounded v2 schema.",
      parsed.error,
    );
  }
  const actualSubject =
    parsed.data.scope.sourceCustody.sourceReviewSubjectSha256;
  if (actualSubject !== expectedSourceSubject(parsed.data.scope)) {
    throw fail(
      "SOURCE_SUBJECT_MISMATCH",
      "The scoped source-review subject does not bind its exact source, verification, registry, and implementation.",
    );
  }
  return planReplayNextSourceCoverageEventV2(parsed.data);
}
