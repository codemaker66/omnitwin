import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_LOCAL_HD_WORKER_MANIFEST_V0 =
  "omnitwin.foundry.local-hd-worker-manifest.v0";
export const FOUNDRY_LOCAL_HD_WORKER_MANIFEST_V0_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_HD_WORKER_MANIFEST_V0";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const FULL_GIT_COMMIT = /^[a-f0-9]{40}$/u;
const REVIEW_DATE = /^\d{4}-\d{2}-\d{2}$/u;

const EXACT_V0_LANE_CONTRACT = {
  camera_registration: {
    componentIds: ["colmap", "hloc"],
    executionLocation: "local_windows_candidate",
    state: "planned_closure_incomplete_execution_disabled",
  },
  e57_read_only_intake: {
    componentIds: ["pye57", "libe57format", "xerces-c"],
    executionLocation: "local_windows_candidate",
    state: "planned_closure_incomplete_execution_disabled",
  },
  gaussian_training: {
    componentIds: ["gsplat"],
    executionLocation: "reviewed_remote_gpu_worker_only",
    state: "execution_disabled_under_current_architecture",
  },
  geometry_registration_and_qa: {
    componentIds: ["open3d"],
    executionLocation: "local_windows_candidate",
    state: "planned_closure_incomplete_execution_disabled",
  },
  photometric_compensation: {
    componentIds: ["ppisp"],
    executionLocation: "reviewed_remote_gpu_worker_only",
    state: "planned_closure_incomplete_execution_disabled",
  },
} as const;

const EXACT_V0_COMPONENT_IDS = [
  "pye57",
  "libe57format",
  "xerces-c",
  "open3d",
  "colmap",
  "hloc",
  "gsplat",
  "ppisp",
] as const;

function equalOrderedStrings(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

const ExactArtifactSchema = z.object({
  kind: z.enum([
    "github_release_asset",
    "github_tag_archive",
    "pypi_wheel",
    "source_archive",
  ]),
  url: z.string().url().max(1_000),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(SHA256_HEX),
  digestEvidence: z.enum([
    "observed",
    "publisher_attested",
    "publisher_attested_and_observed",
  ]),
  reverifyOnAcquire: z.boolean(),
}).strict();

const LegalTextSchema = z.object({
  kind: z.enum(["attribution", "license", "notice"]),
  label: z.string().trim().min(1).max(160),
  url: z.string().url().max(1_000),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(SHA256_HEX),
  redistributionRequired: z.boolean(),
}).strict();

const ComponentSchema = z.object({
  id: z.string().regex(SAFE_ID),
  label: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(240),
  version: z.string().trim().min(1).max(80),
  tag: z.string().trim().min(1).max(120),
  revision: z.string().regex(FULL_GIT_COMMIT),
  repository: z.string().url().max(1_000),
  artifact: ExactArtifactSchema,
  licenseSpdx: z.string().trim().min(1).max(120),
  legalTexts: z.array(LegalTextSchema).min(1).max(12),
  noticeClosureStatus: z.enum([
    "missing_from_selected_binary",
    "open_dependency_notice_review",
  ]),
  closureStatus: z.literal("root_identity_pinned_dependency_closure_open"),
  closureItems: z.array(z.string().trim().min(1).max(500)).min(1).max(40),
  excludedAssets: z.array(z.string().trim().min(1).max(500)).max(40),
  installationState: z.literal("not_installed"),
  runtimeVerificationState: z.literal("not_performed"),
  execution: z.literal("disabled"),
}).strict();

const CapabilityLaneSchema = z.object({
  id: z.enum([
    "camera_registration",
    "e57_read_only_intake",
    "gaussian_training",
    "geometry_registration_and_qa",
    "photometric_compensation",
  ]),
  label: z.string().trim().min(1).max(160),
  runtimeProfile: z.string().trim().min(1).max(240),
  componentIds: z.array(z.string().regex(SAFE_ID)).min(1).max(20),
  executionLocation: z.enum([
    "local_windows_candidate",
    "reviewed_remote_gpu_worker_only",
  ]),
  state: z.enum([
    "planned_closure_incomplete_execution_disabled",
    "execution_disabled_under_current_architecture",
  ]),
  boundary: z.string().trim().min(1).max(700),
}).strict();

const ExclusionSchema = z.object({
  id: z.string().regex(SAFE_ID),
  label: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(700),
}).strict();

const LegacyDockerSchema = z.object({
  path: z.literal("infra/runpod/Dockerfile"),
  disposition: z.literal("do_not_build_run_or_deploy"),
  reason: z.string().trim().min(1).max(700),
}).strict();

const LocalHdWorkerManifestPayloadShape = {
  schemaVersion: z.literal(FOUNDRY_LOCAL_HD_WORKER_MANIFEST_V0),
  manifestId: z.string().regex(SAFE_ID),
  reviewedOn: z.string().regex(REVIEW_DATE),
  reviewClass: z.literal("engineering_screen_only"),
  overall: z.literal("planned_not_installed_not_execution_ready"),
  manifestState: z.literal("recorded_with_open_closure_items"),
  installationState: z.literal("not_installed"),
  runtimeVerificationState: z.literal("not_performed"),
  binding: z.literal("not_bound_to_current_source_or_plan"),
  execution: z.literal("disabled"),
  authority: z.literal("none"),
  architecture: z.object({
    localWindows: z.object({
      status: z.literal("planned_components_only"),
      gaussianTraining: z.literal("not_enabled"),
    }).strict(),
    gpuWorker: z.object({
      status: z.literal("separate_review_required"),
      canonicalForGaussianTraining: z.literal(true),
      workerImage: z.literal("not_defined"),
    }).strict(),
  }).strict(),
  activity: z.object({
    workerInstallationPerformed: z.literal(false),
    workerRuntimeVerificationPerformed: z.literal(false),
    venueDataAccessed: z.literal(false),
    cloudWorkloadStarted: z.literal(false),
    modelOptimizationStarted: z.literal(false),
  }).strict(),
  capabilityLanes: z.array(CapabilityLaneSchema).min(5).max(5),
  components: z.array(ComponentSchema).min(1).max(100),
  exclusions: z.array(ExclusionSchema).min(1).max(100),
  legacyDocker: LegacyDockerSchema,
  nextAction: z.string().trim().min(1).max(700),
} as const;

const _LocalHdWorkerManifestPayloadBaseSchema = z
  .object(LocalHdWorkerManifestPayloadShape)
  .strict();
type LocalHdWorkerManifestPayloadForValidation = z.infer<
  typeof _LocalHdWorkerManifestPayloadBaseSchema
>;

function validateLocalHdWorkerManifestPayload(
  manifest: LocalHdWorkerManifestPayloadForValidation,
  ctx: z.RefinementCtx,
): void {
  const componentIds = manifest.components.map((component) => component.id);
  if (new Set(componentIds).size !== componentIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["components"],
      message: "component ids must be unique",
    });
  }
  if (!equalOrderedStrings(componentIds, EXACT_V0_COMPONENT_IDS)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["components"],
      message: "components must match the exact ordered v0 root identities",
    });
  }

  const exclusionIds = manifest.exclusions.map((exclusion) => exclusion.id);
  if (new Set(exclusionIds).size !== exclusionIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["exclusions"],
      message: "exclusion ids must be unique",
    });
  }

  const laneIds = manifest.capabilityLanes.map((lane) => lane.id);
  if (new Set(laneIds).size !== laneIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["capabilityLanes"],
      message: "capability lane ids must be unique",
    });
  }

  const knownComponents = new Set(componentIds);
  for (const [laneIndex, lane] of manifest.capabilityLanes.entries()) {
    if (new Set(lane.componentIds).size !== lane.componentIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilityLanes", laneIndex, "componentIds"],
        message: "capability lane component ids must be unique",
      });
    }
    for (const [componentIndex, componentId] of lane.componentIds.entries()) {
      if (!knownComponents.has(componentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capabilityLanes", laneIndex, "componentIds", componentIndex],
          message: "capability lane references an unknown component",
        });
      }
    }
    const expectedLane = EXACT_V0_LANE_CONTRACT[lane.id];
    if (
      !equalOrderedStrings(lane.componentIds, expectedLane.componentIds) ||
      lane.executionLocation !== expectedLane.executionLocation ||
      lane.state !== expectedLane.state
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilityLanes", laneIndex],
        message: "capability lane must match the exact disjoint v0 component and execution contract",
      });
    }
  }

  const gaussianLane = manifest.capabilityLanes.find(
    (lane) => lane.id === "gaussian_training",
  );
  if (
    gaussianLane?.executionLocation !== "reviewed_remote_gpu_worker_only" ||
    gaussianLane.state !== "execution_disabled_under_current_architecture"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["capabilityLanes"],
      message: "Gaussian training must remain disabled and bound to the separately reviewed GPU-worker lane",
    });
  }
}

export const FoundryLocalHdWorkerManifestPayloadV0Schema = z
  .object(LocalHdWorkerManifestPayloadShape).strict()
  .superRefine(validateLocalHdWorkerManifestPayload);

export const FoundryLocalHdWorkerManifestV0Schema =
  z.object({
    ...LocalHdWorkerManifestPayloadShape,
    manifestSha256: z.string().regex(SHA256_HEX),
  }).strict().superRefine(validateLocalHdWorkerManifestPayload);

export type FoundryLocalHdWorkerManifestPayloadV0 = z.infer<
  typeof FoundryLocalHdWorkerManifestPayloadV0Schema
>;
export type FoundryLocalHdWorkerManifestV0 = z.infer<
  typeof FoundryLocalHdWorkerManifestV0Schema
>;

export function computeFoundryLocalHdWorkerManifestV0Sha256(
  payload: FoundryLocalHdWorkerManifestPayloadV0,
): string {
  const parsed = FoundryLocalHdWorkerManifestPayloadV0Schema.parse(payload);
  return domainSeparatedSha256(
    FOUNDRY_LOCAL_HD_WORKER_MANIFEST_V0_DIGEST_DOMAIN,
    toCanonicalJson(parsed),
  );
}

export function compileFoundryLocalHdWorkerManifestV0(
  input: FoundryLocalHdWorkerManifestPayloadV0,
): FoundryLocalHdWorkerManifestV0 {
  const payload = FoundryLocalHdWorkerManifestPayloadV0Schema.parse(input);
  return FoundryLocalHdWorkerManifestV0Schema.parse({
    ...payload,
    manifestSha256: computeFoundryLocalHdWorkerManifestV0Sha256(payload),
  });
}

export function verifyFoundryLocalHdWorkerManifestV0(
  input: unknown,
): FoundryLocalHdWorkerManifestV0 {
  const manifest = FoundryLocalHdWorkerManifestV0Schema.parse(input);
  const { manifestSha256, ...payload } = manifest;
  const expected = computeFoundryLocalHdWorkerManifestV0Sha256(payload);
  if (manifestSha256 !== expected) {
    throw new FoundryIntegrityError(
      "LOCAL_HD_WORKER_MANIFEST_DIGEST_MISMATCH",
      "The local HD worker manifest fingerprint does not match its canonical payload.",
    );
  }
  return manifest;
}

export function serializeFoundryLocalHdWorkerManifestV0(
  input: unknown,
): string {
  const manifest = verifyFoundryLocalHdWorkerManifestV0(input);
  return stableCanonicalJson(toCanonicalJson(manifest));
}
