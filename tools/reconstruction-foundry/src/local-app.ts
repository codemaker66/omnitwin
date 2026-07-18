import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { basename, resolve } from "node:path";
import {
  FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
  FoundryOperatorEvidenceChecklistV5Schema,
  FoundryIntegrityError,
  FoundrySourceReadinessMapV5Schema,
  FoundryUniversalSourceFactsV5Schema,
  FoundryUniversalIntakeReceiptSchema,
  compileFoundryOperatorEvidenceChecklistV5,
  compileFoundrySourceReadinessMapV5,
  compileGuidedAdmissionDraft,
  compileFoundryPlanPreview,
  compileFoundryStageAssetRoutingV0,
  inspectUniversalIntakeWithSourceFactsV5,
  serializeFoundryOperatorEvidenceChecklistV5,
  serializeFoundrySourceReadinessMapV5,
  serializeUniversalSourceFactsV5Artifact,
  type FoundryGuidedAdmissionDraft,
  type FoundryOperatorEvidenceChecklistV5,
  type FoundryPipelineWorkerRole,
  type FoundryPlanPreviewV0,
  type FoundrySourceReadinessMapV5,
  type FoundryUniversalIntakeReceipt,
  type FoundryUniversalSourceFactsV5,
} from "@omnitwin/reconstruction-foundry";
import {
  FoundryIngestManifestV0Schema,
  FoundryRelativePathSchema,
  RuntimeSha256Schema,
  type FoundryIngestManifestV0,
  type FoundryInputType,
} from "@omnitwin/types";
import {
  LOCAL_FOUNDRY_APP_CSS,
  LOCAL_FOUNDRY_APP_HTML,
  LOCAL_FOUNDRY_APP_JAVASCRIPT,
} from "./local-app-assets.js";
import {
  LocalReferenceVerificationControllerV0,
  type CreateLocalReferenceVerificationControllerOptionsV0,
  type LocalReferenceVerificationPublicV0,
} from "./local-reference-verification.js";
import {
  captureReferenceVerificationSourceIdentityV0,
  type ReferenceVerificationSourceIdentityV0,
} from "./reference-verification-bridge.js";
import {
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_INITIAL_DTO,
  createLocalOfflineNormalizationPreviewController,
  type CreateLocalOfflineNormalizationPreviewControllerOptions,
  type LocalOfflineNormalizationPreviewDto,
  type LocalOfflineNormalizationPreviewStartRequest,
} from "./local-offline-normalization-preview.js";

export const LOCAL_FOUNDRY_HOST = "127.0.0.1";
// A guided review may contain hundreds of files. Four hours gives a human time
// to finish that review while retaining the hard, bounded automatic shutdown.
export const LOCAL_FOUNDRY_DEFAULT_SESSION_TTL_MS = 4 * 60 * 60 * 1_000;
export const LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES = 1_024;
export const LOCAL_FOUNDRY_MAX_DRAFT_BODY_BYTES = 2 * 1_024 * 1_024;
export const LOCAL_FOUNDRY_MAX_GUIDED_FILES = 500;
export const LOCAL_FOUNDRY_PROCESSING_OUTLINE_V0 =
  "omnitwin.local-foundry.processing-outline.v0";
export const LOCAL_FOUNDRY_PROCESSING_OUTLINE_DISCLAIMER =
  "This is a file-to-activity outline only. It does not select a worker, compile a recipe, or say that any activity can run.";
export const LOCAL_FOUNDRY_QUALITY_DECISION_BOARD_V0 =
  "omnitwin.local-foundry.quality-decision-board.v0";
export const LOCAL_FOUNDRY_QUALITY_DECISION_BOARD_DISCLAIMER =
  "This board compares evidence needs only. It does not choose a winner, measure a quality gain, compile a recipe, or authorize processing.";

const MIN_SESSION_TTL_MS = 50;
const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const SAFE_STOP_RETRY_MS = 100;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const VERIFICATION_REQUEST_ID_PATTERN = /^[a-f0-9]{32}$/u;
const INTAKE_RECEIPT_SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OFFLINE_PREVIEW_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), display-capture=(), fullscreen=(), payment=(), usb=(), serial=(), bluetooth=()",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-DNS-Prefetch-Control": "off",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export type LocalFoundryAppPhase =
  | "inspecting"
  | "ready"
  | "failed"
  | "stopping"
  | "stopped";

export type LocalFoundryStopReason = "operator" | "session_expired" | "programmatic";

export type LocalFoundryProcessingLaneId =
  | "source_review"
  | "point_geometry"
  | "mesh_geometry"
  | "image_video_reconstruction"
  | "alignment_and_operational_geometry"
  | "captured_appearance"
  | "ai_assistance"
  | "learned_visual_representation"
  | "review_and_package_only";

export interface LocalFoundryProcessingLaneV0 {
  readonly id: LocalFoundryProcessingLaneId;
  readonly heading: string;
  readonly explanation: string;
  readonly representedAssets: readonly {
    readonly assetId: string;
    readonly relativePath: string;
  }[];
}

interface LocalFoundryProcessingOutlineBaseV0 {
  readonly schemaVersion: typeof LOCAL_FOUNDRY_PROCESSING_OUTLINE_V0;
  readonly meaning: "read_only_file_to_activity_outline";
  readonly basis: "manifest_and_requested_options";
  readonly recipeState: "not_compiled";
  readonly authority: "none";
  readonly clearance: "not_evaluated";
  readonly disclaimer: typeof LOCAL_FOUNDRY_PROCESSING_OUTLINE_DISCLAIMER;
}

export type LocalFoundryProcessingOutlineV0 =
  | LocalFoundryProcessingOutlineBaseV0 & {
      readonly state: "outline_only";
      readonly lanes: readonly LocalFoundryProcessingLaneV0[];
      readonly affectedAssets: readonly [];
    }
  | LocalFoundryProcessingOutlineBaseV0 & {
      readonly state: "unavailable";
      readonly reason: "xgrids_xbin_has_no_reviewed_route";
      readonly lanes: readonly [];
      readonly affectedAssets: LocalFoundryProcessingLaneV0["representedAssets"];
    };

export type LocalFoundryQualityStrategyId =
  | "preserve_captured_detail"
  | "add_captured_photo_detail"
  | "separate_operational_geometry"
  | "ai_visual_derivative";

export interface LocalFoundryQualityEvidenceRequirementV0 {
  readonly id: string;
  readonly requirement: string;
  readonly state:
    | "not_present"
    | "present_unreviewed"
    | "reviewed_present"
    | "not_evaluated";
  readonly representedAssets: LocalFoundryProcessingLaneV0["representedAssets"];
}

export interface LocalFoundryQualityDecisionCardV0 {
  readonly id: LocalFoundryQualityStrategyId;
  readonly heading: string;
  readonly status:
    | "comparison_required"
    | "candidate"
    | "source_capture_needed"
    | "requested";
  readonly derivativeClass:
    | "captured_runtime_comparison"
    | "enhanced_captured_derived"
    | "captured_derived"
    | "ai_derived";
  readonly expectedGain: "unmeasured";
  readonly representedAssets: LocalFoundryProcessingLaneV0["representedAssets"];
  readonly mechanism: string;
  readonly canDo: string;
  readonly cannotDo: string;
  readonly evidenceRequirements: readonly LocalFoundryQualityEvidenceRequirementV0[];
  readonly likelyFailure: string;
  readonly decisiveNextTest: string;
  readonly alternatives: readonly string[];
}

interface LocalFoundryQualityDecisionBoardBaseV0 {
  readonly schemaVersion: typeof LOCAL_FOUNDRY_QUALITY_DECISION_BOARD_V0;
  readonly meaning: "source_aware_quality_decision_support";
  readonly basis: "admitted_manifest_requested_options_and_shared_router";
  readonly recipeState: "not_compiled";
  readonly authority: "none";
  readonly clearance: "not_evaluated";
  readonly gainEvidence: "unmeasured";
  readonly winner: "not_selected";
  readonly selectionStatement: "No winner is selected before a decisive comparison.";
  readonly disclaimer: typeof LOCAL_FOUNDRY_QUALITY_DECISION_BOARD_DISCLAIMER;
}

export type LocalFoundryQualityDecisionBoardV0 =
  | LocalFoundryQualityDecisionBoardBaseV0 & {
      readonly state: "available";
      readonly cards: readonly LocalFoundryQualityDecisionCardV0[];
      readonly affectedAssets: readonly [];
    }
  | LocalFoundryQualityDecisionBoardBaseV0 & {
      readonly state: "unavailable";
      readonly reason: "xgrids_xbin_has_no_reviewed_route";
      readonly cards: readonly [];
      readonly affectedAssets: LocalFoundryProcessingLaneV0["representedAssets"];
      readonly nextAction: "Request an official export in an open documented format or a vendor-supported route; do not decode XBIN here.";
    };

export interface LocalFoundryPlanPreviewResponseV0 {
  readonly preview: FoundryPlanPreviewV0;
  readonly processingOutline: LocalFoundryProcessingOutlineV0;
  readonly qualityDecisionBoard: LocalFoundryQualityDecisionBoardV0;
}

const PROCESSING_OUTLINE_LANE_SPECS: readonly {
  readonly id: Exclude<LocalFoundryProcessingLaneId, "review_and_package_only">;
  readonly heading: string;
  readonly explanation: string;
  readonly roles: readonly FoundryPipelineWorkerRole[];
}[] = [
  {
    id: "source_review",
    heading: "Source review",
    explanation: "Admitted files are represented for read-only source inspection.",
    roles: ["inspect_sources"],
  },
  {
    id: "point_geometry",
    heading: "Point-cloud geometry",
    explanation:
      "Captured point sources are represented for normalization; this does not establish measurement quality.",
    roles: ["normalize_point_cloud"],
  },
  {
    id: "mesh_geometry",
    heading: "Mesh and CAD geometry",
    explanation:
      "Captured mesh, CAD, BIM, or OpenUSD sources are represented for normalization only.",
    roles: ["normalize_mesh"],
  },
  {
    id: "image_video_reconstruction",
    heading: "Images and video",
    explanation:
      "Captured image, video, calibration, and pose sources are represented somewhere in the image reconstruction lane.",
    roles: ["extract_video_frames", "reconstruct_from_images"],
  },
  {
    id: "alignment_and_operational_geometry",
    heading: "Alignment and operational geometry",
    explanation:
      "Captured source closure is represented for alignment, fusion, and optional operational geometry without a measured-truth claim.",
    roles: ["register_sources", "fuse_measured_geometry", "build_operational_mesh"],
  },
  {
    id: "captured_appearance",
    heading: "Captured-appearance enhancement",
    explanation:
      "Captured sources are represented here, but resulting material remains enhanced-captured, outside measured geometry, and separate from AI-derived output.",
    roles: ["enhance_captured_appearance"],
  },
  {
    id: "ai_assistance",
    heading: "AI assistance",
    explanation:
      "Requested appearance or semantic suggestions remain AI-derived and outside measured geometry.",
    roles: ["infer_hd_appearance", "infer_semantics"],
  },
  {
    id: "learned_visual_representation",
    heading: "Learned visual representation",
    explanation:
      "Requested neural training remains rights-gated; this outline does not say it is cleared or runnable.",
    roles: ["optimize_neural_scene"],
  },
];

export interface LocalFoundryPublicState {
  readonly phase: Exclude<LocalFoundryAppPhase, "stopped">;
  readonly sourceLabel: string;
  readonly startedAt: string;
  readonly expiresAt: string;
  readonly progress: {
    readonly step: 1 | 2 | 3;
    readonly totalSteps: 3;
    readonly message: string;
  };
  readonly safety: {
    readonly sourceAccess: "read_only";
    readonly networkScope: "this_computer_only";
    readonly uploads: "disabled";
    readonly reconstruction: "disabled";
    readonly admission: "draft_only";
    readonly planning: "preview_only";
    readonly execution: "disabled";
    readonly authority: "none";
  };
  readonly guidedWorkflow: {
    readonly maximumFiles: typeof LOCAL_FOUNDRY_MAX_GUIDED_FILES;
    readonly admissionDraft: "not_built" | "ready";
    readonly admissionReviewSha256: string | null;
    readonly admissionResultSha256: string | null;
    readonly planPreview: "not_built" | "ready";
    readonly planPreviewSha256: string | null;
  };
  readonly offlineNormalizationPreview: LocalOfflineNormalizationPreviewDto;
  readonly safeFailure?: string;
  readonly receipt?: FoundryUniversalIntakeReceipt;
  readonly sourceFacts?: FoundryUniversalSourceFactsV5;
  readonly sourceReadiness?: FoundrySourceReadinessMapV5;
  readonly operatorEvidenceChecklist?: FoundryOperatorEvidenceChecklistV5;
}

export interface LocalFoundryAppOptions {
  readonly source: string;
  readonly port?: number;
  readonly host?: string;
  readonly sessionTtlMs?: number;
  /** Trusted process configuration only; never accepted from the browser. */
  readonly privateStateRoot?: string;
  /**
   * Trusted process configuration only. The browser can never provide or
   * replace source paths, signed permits, or the pinned public-key ring.
   */
  readonly offlineNormalizationPreview?: CreateLocalOfflineNormalizationPreviewControllerOptions;
  /** @internal Deterministic HTTP backpressure hook; production callers omit this. */
  readonly offlineNormalizationPreviewTestHooks?: {
    readonly responseChunkDelayMs?: number;
  };
  /** @internal Deterministic focused-test hooks; production callers omit this. */
  readonly referenceVerificationTestHooks?: CreateLocalReferenceVerificationControllerOptionsV0["testHooks"];
}

export interface LocalFoundryAppClosed {
  readonly reason: LocalFoundryStopReason;
}

export interface LocalFoundryAppHandle {
  readonly host: typeof LOCAL_FOUNDRY_HOST;
  readonly port: number;
  readonly origin: string;
  readonly url: string;
  readonly sourceLabel: string;
  readonly closed: Promise<LocalFoundryAppClosed>;
  readonly stop: () => Promise<void>;
  readonly getPhase: () => LocalFoundryAppPhase;
}

class SafeHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "SafeHttpError";
    this.statusCode = statusCode;
  }
}

function safeSourceLabel(source: string): string {
  const candidate = basename(resolve(source)).trim();
  if (
    candidate.length === 0 ||
    candidate.length > 240 ||
    !FoundryRelativePathSchema.safeParse(candidate).success
  ) {
    return "selected source";
  }
  return candidate;
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || (port !== 0 && (port < 1_024 || port > 65_535))) {
    throw new Error("The local app port must be between 1024 and 65535, or omitted for an automatic port.");
  }
}

function validateSessionTtl(sessionTtlMs: number): void {
  if (
    !Number.isSafeInteger(sessionTtlMs) ||
    sessionTtlMs < MIN_SESSION_TTL_MS ||
    sessionTtlMs > MAX_SESSION_TTL_MS
  ) {
    throw new Error("The local app session length is outside the safe range.");
  }
}

function constantTimeTokenMatch(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}

function assertNoQuery(url: URL): void {
  if ([...url.searchParams.keys()].length > 0) {
    throw new SafeHttpError(400, "This route does not accept query options.");
  }
}

function requireSessionToken(url: URL, expectedToken: string): void {
  const entries = [...url.searchParams.entries()];
  if (
    entries.length !== 1 ||
    entries[0]?.[0] !== "token" ||
    !constantTimeTokenMatch(entries[0][1], expectedToken)
  ) {
    throw new SafeHttpError(401, "This local session link is missing or has expired.");
  }
}

function requireArtifactTokenAndDigest(url: URL, expectedToken: string): string {
  const entries = [...url.searchParams.entries()];
  const tokenValues = url.searchParams.getAll("token");
  const digestValues = url.searchParams.getAll("digest");
  if (
    entries.length !== 2 ||
    tokenValues.length !== 1 ||
    digestValues.length !== 1 ||
    !constantTimeTokenMatch(tokenValues[0] ?? "", expectedToken)
  ) {
    throw new SafeHttpError(401, "This local session link is missing or has expired.");
  }
  const digest = RuntimeSha256Schema.safeParse(digestValues[0]);
  if (!digest.success) {
    throw new SafeHttpError(409, "That draft fingerprint is invalid or no longer current.");
  }
  return digest.data;
}

function requireOfflinePreviewArtifactToken(
  url: URL,
  expectedToken: string,
): { readonly requestId: string; readonly digest: string } {
  const entries = [...url.searchParams.entries()];
  const tokenValues = url.searchParams.getAll("token");
  const requestIdValues = url.searchParams.getAll("requestId");
  const digestValues = url.searchParams.getAll("digest");
  if (
    entries.length !== 3 ||
    tokenValues.length !== 1 ||
    requestIdValues.length !== 1 ||
    digestValues.length !== 1 ||
    !constantTimeTokenMatch(tokenValues[0] ?? "", expectedToken)
  ) {
    throw new SafeHttpError(401, "This local session link is missing or has expired.");
  }
  const requestId = requestIdValues[0] ?? "";
  const digest = digestValues[0] ?? "";
  if (!VERIFICATION_REQUEST_ID_PATTERN.test(requestId)) {
    throw new SafeHttpError(409, "That private preview request is invalid or no longer current.");
  }
  if (!OFFLINE_PREVIEW_DIGEST_PATTERN.test(digest)) {
    throw new SafeHttpError(409, "That private preview fingerprint is invalid or no longer current.");
  }
  return { requestId, digest };
}

function requireSourceFactsTokenAndDigest(url: URL, expectedToken: string): string {
  const entries = [...url.searchParams.entries()];
  const tokenValues = url.searchParams.getAll("token");
  const digestValues = url.searchParams.getAll("digest");
  if (
    entries.length !== 2 ||
    tokenValues.length !== 1 ||
    digestValues.length !== 1 ||
    !constantTimeTokenMatch(tokenValues[0] ?? "", expectedToken)
  ) {
    throw new SafeHttpError(401, "This local session link is missing or has expired.");
  }
  const digest = digestValues[0] ?? "";
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new SafeHttpError(409, "That Source Facts fingerprint is invalid or no longer current.");
  }
  return digest;
}

function requireSourceReadinessTokenAndDigest(url: URL, expectedToken: string): string {
  const entries = [...url.searchParams.entries()];
  const tokenValues = url.searchParams.getAll("token");
  const digestValues = url.searchParams.getAll("digest");
  if (
    entries.length !== 2 ||
    tokenValues.length !== 1 ||
    digestValues.length !== 1 ||
    !constantTimeTokenMatch(tokenValues[0] ?? "", expectedToken)
  ) {
    throw new SafeHttpError(401, "This local session link is missing or has expired.");
  }
  const digest = digestValues[0] ?? "";
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new SafeHttpError(409, "That Source Readiness fingerprint is invalid or no longer current.");
  }
  return digest;
}

function requireOperatorEvidenceChecklistTokenAndDigest(
  url: URL,
  expectedToken: string,
): string {
  const entries = [...url.searchParams.entries()];
  const tokenValues = url.searchParams.getAll("token");
  const digestValues = url.searchParams.getAll("digest");
  if (
    entries.length !== 2 ||
    tokenValues.length !== 1 ||
    digestValues.length !== 1 ||
    !constantTimeTokenMatch(tokenValues[0] ?? "", expectedToken)
  ) {
    throw new SafeHttpError(401, "This local session link is missing or has expired.");
  }
  const digest = digestValues[0] ?? "";
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new SafeHttpError(
      409,
      "That Operator Evidence Checklist fingerprint is invalid or no longer current.",
    );
  }
  return digest;
}

function setSecurityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
}

function send(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  setSecurityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", Buffer.byteLength(body));
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  response.end(body);
}

function sendBytes(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: Buffer,
  extraHeaders: Readonly<Record<string, string>> = {},
  dispose?: () => void,
  chunkDelayMs = 0,
): void {
  setSecurityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", body.byteLength);
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  let disposed = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  const disposeOnce = (): void => {
    if (disposed) return;
    disposed = true;
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = null;
    dispose?.();
  };
  response.once("finish", disposeOnce);
  response.once("close", disposeOnce);
  response.once("error", disposeOnce);
  const maximumChunkBytes = 64 * 1024;
  let offset = 0;
  const scheduleNext = (): void => {
    if (chunkDelayMs <= 0) {
      writeNext();
      return;
    }
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      writeNext();
    }, chunkDelayMs);
    pendingTimer.unref();
  };
  const writeNext = (): void => {
    if (disposed || response.destroyed) return;
    try {
      while (offset < body.byteLength) {
        const end = Math.min(offset + maximumChunkBytes, body.byteLength);
        const accepted = response.write(body.subarray(offset, end));
        offset = end;
        if (!accepted) {
          response.once("drain", scheduleNext);
          return;
        }
        if (chunkDelayMs > 0) {
          scheduleNext();
          return;
        }
      }
      response.end();
    } catch (error: unknown) {
      disposeOnce();
      response.destroy(
        error instanceof Error
          ? error
          : new Error("The byte response failed.", { cause: error }),
      );
    }
  };
  writeNext();
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  send(response, statusCode, "application/json; charset=utf-8", `${JSON.stringify(value)}\n`);
}

function sendError(response: ServerResponse, error: SafeHttpError): void {
  sendJson(response, error.statusCode, { error: error.message });
}

function assertLoopbackSocket(request: IncomingMessage): void {
  if (
    request.socket.localAddress !== LOCAL_FOUNDRY_HOST ||
    request.socket.remoteAddress !== LOCAL_FOUNDRY_HOST
  ) {
    throw new SafeHttpError(403, "This app accepts connections from this computer only.");
  }
}

function assertHostAndOrigin(
  request: IncomingMessage,
  expectedHost: string,
  expectedOrigin: string,
): void {
  if (request.headers.host !== expectedHost) {
    throw new SafeHttpError(421, "The local app address is not valid for this session.");
  }
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== expectedOrigin) {
    throw new SafeHttpError(403, "Requests from another website are not accepted.");
  }
}

async function readJsonObject(
  request: IncomingMessage,
  maximumBytes: number,
  requestName: string,
): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new SafeHttpError(415, `${requestName} must use JSON.`);
  }
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    if (!/^\d+$/u.test(contentLength)) throw new SafeHttpError(400, "The request size is invalid.");
    if (Number(contentLength) > maximumBytes) {
      request.resume();
      throw new SafeHttpError(413, "The request is too large.");
    }
  }
  const body = await new Promise<Buffer>((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let byteCount = 0;
    let rejected = false;
    request.on("data", (chunk: Buffer | string) => {
      if (rejected) return;
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      byteCount += bytes.length;
      if (byteCount > maximumBytes) {
        rejected = true;
        request.resume();
        rejectBody(new SafeHttpError(413, "The request is too large."));
        return;
      }
      chunks.push(bytes);
    });
    request.on("end", () => {
      if (!rejected) resolveBody(Buffer.concat(chunks));
    });
    request.on("error", () => {
      if (!rejected) rejectBody(new SafeHttpError(400, "The request could not be read."));
    });
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new SafeHttpError(400, `${requestName} is not valid JSON.`);
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new SafeHttpError(400, `${requestName} must be one JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  requestName: string,
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new SafeHttpError(
      400,
      `${requestName} contains an option this local app does not accept. No draft was created.`,
    );
  }
}

function assertRequiredExactKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  requestName: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...requiredKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new SafeHttpError(
      400,
      `${requestName} must contain exactly the fields shown by this local app.`,
    );
  }
}

function requireSameOriginPost(request: IncomingMessage, expectedOrigin: string): void {
  if (request.headers.origin !== expectedOrigin) {
    throw new SafeHttpError(403, "The request must come from this local app.");
  }
}

function parseVerificationRequestId(value: unknown): string {
  if (typeof value !== "string" || !VERIFICATION_REQUEST_ID_PATTERN.test(value)) {
    throw new SafeHttpError(400, "The approved-file check request is invalid.");
  }
  return value;
}

function parseOfflinePreviewRequestId(value: unknown): string {
  if (typeof value !== "string" || !VERIFICATION_REQUEST_ID_PATTERN.test(value)) {
    throw new SafeHttpError(400, "The private offline preview request is invalid.");
  }
  return value;
}

function parseOfflinePreviewStartRequest(
  body: Record<string, unknown>,
): LocalOfflineNormalizationPreviewStartRequest {
  assertRequiredExactKeys(
    body,
    ["receiptSha256", "previewAssetId", "requestId"],
    "The private offline preview request",
  );
  if (
    typeof body.receiptSha256 !== "string" ||
    !INTAKE_RECEIPT_SHA256_PATTERN.test(body.receiptSha256)
  ) {
    throw new SafeHttpError(409, "The intake receipt changed. Refresh this local page before trying again.");
  }
  if (
    typeof body.previewAssetId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/u.test(body.previewAssetId)
  ) {
    throw new SafeHttpError(400, "The private preview asset reference is invalid.");
  }
  return {
    receiptSha256: body.receiptSha256,
    previewAssetId: body.previewAssetId,
    requestId: parseOfflinePreviewRequestId(body.requestId),
  };
}

function parseVerificationJobReference(
  body: Record<string, unknown>,
): { readonly jobId: string; readonly revision: number; readonly run: number } {
  if (
    typeof body.jobId !== "string" ||
    !Number.isSafeInteger(body.revision) ||
    (body.revision as number) < 1 ||
    !Number.isSafeInteger(body.run) ||
    (body.run as number) < 1
  ) {
    throw new SafeHttpError(400, "The approved-file check reference is invalid.");
  }
  return {
    jobId: body.jobId,
    revision: body.revision as number,
    run: body.run as number,
  };
}

function parseVerificationAdmissionDigest(value: unknown): string {
  const parsed = RuntimeSha256Schema.safeParse(value);
  if (!parsed.success) {
    throw new SafeHttpError(409, "The review draft changed. Build the approved-file check again.");
  }
  return parsed.data;
}

function safeVerificationRouteFailure(action: "start" | "status" | "cancel" | "resume" | "report"): SafeHttpError {
  const messages = {
    start: "The approved-file check could not start because the source or review may have changed. Build a fresh receipt and review draft.",
    status: "The current approved-file check could not be read safely.",
    cancel: "The approved-file check could not be stopped from this request. Check its current state and try again.",
    resume: "The approved-file check could not restart safely. Check its current state or build a fresh check.",
    report: "A verified report is not ready for this approved-file check.",
  } as const;
  return new SafeHttpError(409, messages[action]);
}

async function readEmptyJsonObject(request: IncomingMessage): Promise<void> {
  const parsed = await readJsonObject(
    request,
    LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
    "The stop request",
  );
  if (Object.keys(parsed).length !== 0) {
    throw new SafeHttpError(400, "The stop request cannot contain options or file paths.");
  }
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      rejectPort(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address() as AddressInfo | null;
      if (address === null || address.address !== LOCAL_FOUNDRY_HOST) {
        rejectPort(new Error("The local app did not bind to the required loopback address."));
        return;
      }
      resolvePort(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: LOCAL_FOUNDRY_HOST, port, exclusive: true });
  });
}

function safeInspectionFailure(): string {
  return "The selected source could not be read safely. It may have moved, changed while being checked, or contain a link or special entry. Check the source, then start a new local session.";
}

function compareOutlineAssetIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compileLocalFoundryProcessingOutlineV0(
  manifest: FoundryIngestManifestV0,
  options: FoundryPlanPreviewV0["options"],
): LocalFoundryProcessingOutlineV0 {
  const base: LocalFoundryProcessingOutlineBaseV0 = {
    schemaVersion: LOCAL_FOUNDRY_PROCESSING_OUTLINE_V0,
    meaning: "read_only_file_to_activity_outline",
    basis: "manifest_and_requested_options",
    recipeState: "not_compiled",
    authority: "none",
    clearance: "not_evaluated",
    disclaimer: LOCAL_FOUNDRY_PROCESSING_OUTLINE_DISCLAIMER,
  };
  const assetById = new Map(
    manifest.assets.map((asset) => [asset.id, asset] as const),
  );
  const representedAssets = (assetIds: readonly string[]) =>
    assetIds.map((assetId) => {
      const asset = assetById.get(assetId);
      if (asset === undefined) {
        throw new FoundryIntegrityError(
          "LOCAL_PROCESSING_OUTLINE_ASSET_MISSING",
          "The shared route referenced an asset outside the admitted manifest.",
        );
      }
      return { assetId, relativePath: asset.relativePath };
    });
  try {
    const routes = compileFoundryStageAssetRoutingV0(manifest, options);
    const lanes: LocalFoundryProcessingLaneV0[] = [];
    for (const specification of PROCESSING_OUTLINE_LANE_SPECS) {
      const representedAssetIds = new Set<string>();
      for (const route of routes) {
        if (!specification.roles.includes(route.role)) continue;
        for (const assetId of route.inputAssetIds) representedAssetIds.add(assetId);
      }
      if (representedAssetIds.size === 0) continue;
      lanes.push({
        id: specification.id,
        heading: specification.heading,
        explanation: specification.explanation,
        representedAssets: representedAssets(
          [...representedAssetIds].sort(compareOutlineAssetIds),
        ),
      });
    }

    const routedBeyondReview = new Set<string>();
    for (const route of routes) {
      if (
        route.role === "inspect_sources" || route.role === "qa_candidate" ||
        route.role === "package_candidate"
      ) {
        continue;
      }
      for (const assetId of route.inputAssetIds) routedBeyondReview.add(assetId);
    }
    const reviewAndPackageOnlyIds = manifest.assets
      .map((asset) => asset.id)
      .filter((assetId) => !routedBeyondReview.has(assetId))
      .sort(compareOutlineAssetIds);
    if (reviewAndPackageOnlyIds.length > 0) {
      lanes.push({
        id: "review_and_package_only",
        heading: "Review and package only",
        explanation:
          "These admitted files are represented only for source review, candidate review, and packaging—not a reconstruction lane.",
        representedAssets: representedAssets(reviewAndPackageOnlyIds),
      });
    }

    return {
      ...base,
      state: "outline_only",
      lanes,
      affectedAssets: [],
    };
  } catch (error: unknown) {
    if (
      error instanceof FoundryIntegrityError &&
      error.code === "PIPELINE_INPUT_UNROUTABLE_XGRIDS_XBIN"
    ) {
      return {
        ...base,
        state: "unavailable",
        reason: "xgrids_xbin_has_no_reviewed_route",
        lanes: [],
        affectedAssets: representedAssets(
          manifest.assets
            .filter((asset) => asset.inputType === "xgrids_xbin")
            .map((asset) => asset.id)
            .sort(compareOutlineAssetIds),
        ),
      };
    }
    throw error;
  }
}

const QUALITY_POINT_TYPES: ReadonlySet<FoundryInputType> = new Set([
  "matterport_e57",
  "generic_e57",
  "las_laz",
  "xyz_point_cloud",
  "ply_point_cloud",
  "rgbd",
]);
const QUALITY_MESH_TYPES: ReadonlySet<FoundryInputType> = new Set([
  "obj",
  "fbx",
  "glb_gltf",
  "cad_bim",
  "openusd",
]);
const QUALITY_IMAGE_TYPES: ReadonlySet<FoundryInputType> = new Set([
  "matterport_panorama",
  "dslr_image",
  "generic_image",
  "panorama_360",
  "phone_image",
  "drone_media",
]);
const QUALITY_SPLAT_TYPES: ReadonlySet<FoundryInputType> = new Set([
  "spz",
  "sog",
  "gaussian_ply",
]);
/**
 * Builds source-aware quality decision support from the same deterministic route
 * compiler used by the strict plan preview. The result is explanatory only and
 * deliberately remains outside the downloaded, digest-bound plan dossier.
 */
export function compileLocalFoundryQualityDecisionBoardV0(
  manifestInput: FoundryIngestManifestV0,
  options: FoundryPlanPreviewV0["options"],
): LocalFoundryQualityDecisionBoardV0 {
  const manifest = FoundryIngestManifestV0Schema.parse(manifestInput);
  const base: LocalFoundryQualityDecisionBoardBaseV0 = {
    schemaVersion: LOCAL_FOUNDRY_QUALITY_DECISION_BOARD_V0,
    meaning: "source_aware_quality_decision_support",
    basis: "admitted_manifest_requested_options_and_shared_router",
    recipeState: "not_compiled",
    authority: "none",
    clearance: "not_evaluated",
    gainEvidence: "unmeasured",
    winner: "not_selected",
    selectionStatement: "No winner is selected before a decisive comparison.",
    disclaimer: LOCAL_FOUNDRY_QUALITY_DECISION_BOARD_DISCLAIMER,
  };
  const assetById = new Map(manifest.assets.map((asset) => [asset.id, asset] as const));
  const representedAssets = (
    assetIds: readonly string[],
  ): LocalFoundryProcessingLaneV0["representedAssets"] =>
    [...new Set(assetIds)].sort(compareOutlineAssetIds).map((assetId) => {
      const asset = assetById.get(assetId);
      if (asset === undefined) {
        throw new FoundryIntegrityError(
          "LOCAL_QUALITY_DECISION_ASSET_MISSING",
          "The shared route referenced an asset outside the admitted manifest.",
        );
      }
      return { assetId, relativePath: asset.relativePath };
    });

  try {
    const routes = compileFoundryStageAssetRoutingV0(manifest, options);
    const routeAssetIds = (role: FoundryPipelineWorkerRole): readonly string[] =>
      routes.find((route) => route.role === role)?.inputAssetIds ?? [];
    const routeAssetIdSet = (roles: readonly FoundryPipelineWorkerRole[]): Set<string> =>
      new Set(roles.flatMap((role) => routeAssetIds(role)));
    const capturedIds = (
      candidateIds: ReadonlySet<string>,
      predicate: (inputType: FoundryInputType) => boolean,
    ): string[] => manifest.assets
      .filter((asset) =>
        candidateIds.has(asset.id) &&
        asset.provenanceClass === "captured" &&
        predicate(asset.inputType)
      )
      .map((asset) => asset.id)
      .sort(compareOutlineAssetIds);

    const appearanceRouteIds = routeAssetIdSet(["enhance_captured_appearance"]);
    const splatIds = capturedIds(
      appearanceRouteIds,
      (inputType) => QUALITY_SPLAT_TYPES.has(inputType),
    );
    const geometryRouteIds = routeAssetIdSet([
      "normalize_point_cloud",
      "normalize_mesh",
      "reconstruct_from_images",
      "register_sources",
    ]);
    const geometryIds = [...routeAssetIds("register_sources")]
      .sort(compareOutlineAssetIds);
    const anchorIds = capturedIds(
      geometryRouteIds,
      (inputType) =>
        QUALITY_POINT_TYPES.has(inputType) || QUALITY_MESH_TYPES.has(inputType),
    );
    const photoVideoIds = capturedIds(
      geometryRouteIds,
      (inputType) => QUALITY_IMAGE_TYPES.has(inputType) || inputType === "video",
    );
    const photoDetailIds = [...new Set([...geometryIds, ...splatIds])]
      .sort(compareOutlineAssetIds);
    const aiRouteIds = [...routeAssetIds("infer_hd_appearance")]
      .sort(compareOutlineAssetIds);
    const aiIds = representedAssets(aiRouteIds);
    const evidenceAssetIds = (
      evidenceKind: FoundryIngestManifestV0["assets"][number]["evidenceKinds"][number],
    ): string[] => manifest.assets
      .filter((asset) => asset.evidenceKinds.includes(evidenceKind))
      .map((asset) => asset.id)
      .sort(compareOutlineAssetIds);
    const transformEvidenceIds = (reviewedOnly: boolean): string[] =>
      [...new Set(manifest.transforms
        .filter((transform) => !reviewedOnly || transform.state === "reviewed")
        .flatMap((transform) => [
          ...transform.provenanceAssetIds,
          transform.transformArtifactAssetId,
          transform.residualReportAssetId,
          transform.projectionArtifactAssetId,
          transform.reviewerAttestationAssetId,
        ])
        .filter((assetId): assetId is string => assetId !== null))]
        .sort(compareOutlineAssetIds);
    const allTransformEvidenceIds = transformEvidenceIds(false);
    const reviewedTransformEvidenceIds = transformEvidenceIds(true);
    const calibrationIds = [...new Set([
      ...manifest.assets
        .filter((asset) =>
          asset.inputType === "calibration_bundle" ||
          asset.evidenceKinds.includes("calibration_record")
        )
        .map((asset) => asset.id),
      ...manifest.assets
        .filter((asset) => photoVideoIds.includes(asset.id))
        .flatMap((asset) => asset.calibrationAssetIds),
    ])].sort(compareOutlineAssetIds);
    const controlIds = manifest.assets
      .filter((asset) => asset.inputType === "control_network")
      .map((asset) => asset.id)
      .sort(compareOutlineAssetIds);
    const residualIds = evidenceAssetIds("residual_report");
    const fixedViewIds = evidenceAssetIds("fixed_view");
    const qualityReportIds = evidenceAssetIds("quality_report");
    const reviewerAttestationIds = evidenceAssetIds("reviewer_attestation");
    const maskIds = evidenceAssetIds("mask");
    const declaredTransformState: LocalFoundryQualityEvidenceRequirementV0["state"] =
      reviewedTransformEvidenceIds.length > 0
        ? "reviewed_present"
        : allTransformEvidenceIds.length > 0
          ? "present_unreviewed"
          : "not_present";
    const completeRegistrationState: LocalFoundryQualityEvidenceRequirementV0["state"] =
      allTransformEvidenceIds.length > 0 ? "not_evaluated" : "not_present";
    const controlResidualIds = [...new Set([
      ...controlIds,
      ...residualIds,
      ...allTransformEvidenceIds,
    ])].sort(compareOutlineAssetIds);
    const controlResidualState: LocalFoundryQualityEvidenceRequirementV0["state"] =
      controlResidualIds.length > 0 ? "not_evaluated" : "not_present";
    const coordinateEvidenceIds = geometryIds.filter((assetId) => {
      const asset = assetById.get(assetId);
      return asset !== undefined &&
        (asset.coordinateFrameId !== null ||
          !["none", "unknown"].includes(asset.inspection.scaleValue));
    });
    const rightsState = (
      assetIds: readonly string[],
    ): LocalFoundryQualityEvidenceRequirementV0["state"] => {
      const relevantAssets = assetIds
        .map((assetId) => assetById.get(assetId))
        .filter((asset): asset is FoundryIngestManifestV0["assets"][number] =>
          asset !== undefined
        );
      if (relevantAssets.length === 0) return "not_present";
      const reviewed = manifest.legalReviewState === "approved" && relevantAssets.every(
        (asset) =>
          asset.rights.basis !== "unknown" &&
          asset.rights.commercialUse === "allowed" &&
          asset.rights.modelTrainingUse === "allowed" &&
          asset.rights.redistribution === "allowed" &&
          asset.rights.termsReviewedAt !== null &&
          asset.rights.termsReference !== null,
      );
      return reviewed ? "reviewed_present" : "present_unreviewed";
    };
    const presentState = (
      assetIds: readonly string[],
    ): LocalFoundryQualityEvidenceRequirementV0["state"] =>
      assetIds.length > 0 ? "present_unreviewed" : "not_present";
    const requirement = (
      id: string,
      requirementText: string,
      state: LocalFoundryQualityEvidenceRequirementV0["state"],
      assetIds: readonly string[],
    ): LocalFoundryQualityEvidenceRequirementV0 => ({
      id,
      requirement: requirementText,
      state,
      representedAssets: representedAssets(assetIds),
    });
    const runtimeComparisonEvidenceIds = [...new Set([
      ...fixedViewIds,
      ...qualityReportIds,
    ])].sort(compareOutlineAssetIds);
    const humanReviewIds = [...new Set([
      ...qualityReportIds,
      ...reviewerAttestationIds,
    ])].sort(compareOutlineAssetIds);
    const cards: LocalFoundryQualityDecisionCardV0[] = [
      {
        id: "preserve_captured_detail",
        heading: "Preserve detail already present in captured splats",
        status: splatIds.length > 0 ? "comparison_required" : "source_capture_needed",
        derivativeClass: "captured_runtime_comparison",
        expectedGain: "unmeasured",
        representedAssets: representedAssets(splatIds),
        mechanism:
          "Compare the source-master captured splat with each runtime codec, LOD, renderer, and lossless-cleanup variant at identical frozen camera views.",
        canDo:
          "A source-master/runtime comparison can preserve or reveal information already present by identifying codec, delivery, or renderer loss.",
        cannotDo:
          "It cannot add new physical detail, viewpoints, measurements, or observations that the captured source does not contain.",
        evidenceRequirements: [
          requirement(
            "source_runtime_fixed_view_comparison",
            "A synchronized source-master versus runtime comparison at frozen camera views and display scale.",
            presentState(runtimeComparisonEvidenceIds),
            runtimeComparisonEvidenceIds,
          ),
          requirement(
            "runtime_settings_record",
            "Recorded codec, LOD, renderer, display scale, and device settings for every compared output.",
            "not_evaluated",
            [],
          ),
        ],
        likelyFailure:
          "A sharper-looking setting may expose delivery differences while leaving the captured information ceiling unchanged or introducing unstable artefacts.",
        decisiveNextTest:
          "Render the source-master and every runtime/codec candidate at identical frozen cameras and display scale, then compare loss and stability without selecting a winner in advance.",
        alternatives: [
          "Use real recapture with rights-cleared high-resolution photos or video when the source-master itself lacks the required detail.",
        ],
      },
      {
        id: "add_captured_photo_detail",
        heading: "Add real captured photo or video detail",
        status: photoVideoIds.length > 0 && anchorIds.length > 0
          ? "candidate"
          : "source_capture_needed",
        derivativeClass: "enhanced_captured_derived",
        expectedGain: "unmeasured",
        representedAssets: representedAssets(photoDetailIds),
        mechanism:
          "Register rights-cleared photos or video frames to captured venue geometry, then fuse only observed appearance into an enhanced-captured derivative.",
        canDo:
          "Sharp, overlapping, calibrated photo or video observations can contribute real observed surface detail where registration and held-out review succeed.",
        cannotDo:
          "The E57 type alone does not establish accuracy, recover unseen surfaces, or turn unregistered imagery into measured truth.",
        evidenceRequirements: [
          requirement(
            "rights_cleared_photo_video",
            "Sharp, overlapping photos or video of the weak regions.",
            presentState(photoVideoIds),
            photoVideoIds,
          ),
          requirement(
            "venue_frame_anchor",
            "A captured point or mesh anchor for venue scale and alignment.",
            presentState(anchorIds),
            anchorIds,
          ),
          requirement(
            "camera_calibration",
            "Camera calibration evidence for the represented photo or video sources.",
            presentState(calibrationIds),
            calibrationIds,
          ),
          requirement(
            "declared_transform_artifacts",
            "Transform, residual, and attestation artifacts declared in the manifest; their presence does not establish relevance or complete frame coverage.",
            declaredTransformState,
            allTransformEvidenceIds,
          ),
          requirement(
            "photo_video_registration",
            "Complete photo/video-to-geometry registration coverage across every relevant source and anchor frame.",
            completeRegistrationState,
            allTransformEvidenceIds,
          ),
          requirement(
            "control_and_residuals",
            "Scale, coordinate-frame, control, and transform-residual evidence.",
            controlResidualState,
            controlResidualIds,
          ),
          requirement(
            "source_rights",
            "Purpose-specific processing, derivative, redistribution, and publication rights for represented sources.",
            rightsState(photoDetailIds),
            photoDetailIds,
          ),
          requirement(
            "held_out_fixed_views",
            "A frozen held-out image set and fixed-view comparison protocol.",
            presentState(fixedViewIds),
            fixedViewIds,
          ),
        ],
        likelyFailure:
          "Blur, weak overlap, reflective surfaces, exposure change, or poor camera-to-geometry registration can create ghosting or false sharpness.",
        decisiveNextTest:
          "Freeze held-out images and fixed views, register a bounded photo/video subset, compare it with captured-only at the same cameras, and report geometric residuals separately from visual review.",
        alternatives: [
          "Recapture the weak region with calibrated, overlapping imagery when the supplied media cannot support a stable registration.",
          "Keep the captured-only representation when the bounded comparison does not survive held-out review.",
        ],
      },
      {
        id: "separate_operational_geometry",
        heading: "Keep operational geometry separate from appearance",
        status: geometryIds.length > 0 ? "candidate" : "source_capture_needed",
        derivativeClass: "captured_derived",
        expectedGain: "unmeasured",
        representedAssets: representedAssets(geometryIds),
        mechanism:
          "Normalize and register captured point, mesh, image, video, and reviewed support sources before proposing a separately reviewed operational surface.",
        canDo:
          "A reviewed geometry candidate can support later collision, navigation, room boundaries, or planning at the accuracy tier its control evidence actually demonstrates.",
        cannotDo:
          "A file extension, visual splat, or AI output cannot establish metric authority; no geometry here is reviewed or approved for measurement.",
        evidenceRequirements: [
          requirement(
            "coordinate_scale_provenance",
            "Declared units, coordinate frame, scale, and source provenance.",
            presentState(coordinateEvidenceIds),
            coordinateEvidenceIds,
          ),
          requirement(
            "declared_transform_artifacts",
            "Transform, residual, and attestation artifacts declared in the manifest; their presence does not establish relevance or complete frame coverage.",
            declaredTransformState,
            allTransformEvidenceIds,
          ),
          requirement(
            "reviewed_transforms",
            "Complete reviewed transform and residual coverage between every load-bearing frame.",
            completeRegistrationState,
            allTransformEvidenceIds,
          ),
          requirement(
            "independent_control",
            "Independent fit control and frozen blind checks at the required accuracy tier; manifest presence alone cannot establish independence.",
            controlResidualIds.length > 0 ? "not_evaluated" : "not_present",
            controlResidualIds,
          ),
          requirement(
            "qualified_local_failure_review",
            "A qualified human review of local failures, thin structures, reflections, and under-observed regions.",
            presentState(humanReviewIds),
            humanReviewIds,
          ),
        ],
        likelyFailure:
          "Repeated architecture, weak overlap, unit mistakes, or visually plausible alignment can hide local geometric drift.",
        decisiveNextTest:
          "Evaluate a bounded registered candidate against independent fit control and untouched blind checks, then report global and local residuals without using appearance as accuracy evidence.",
        alternatives: [
          "Keep authority none and use the sources only as a visual reference when independent control is unavailable.",
        ],
      },
    ];

    if (options.hdAppearance !== "captured_only") {
      cards.push({
        id: "ai_visual_derivative",
        heading: "Explore a separately labelled AI visual derivative",
        status: "requested",
        derivativeClass: "ai_derived",
        expectedGain: "unmeasured",
        representedAssets: aiIds,
        mechanism:
          "Use the requested model path only as an AI-derived visual candidate conditioned on eligible captured or enhanced-captured sources.",
        canDo:
          "It can propose a reversible visual treatment for bounded weak regions when its licence, masks, provenance, and multi-view review are complete.",
        cannotDo:
          "It cannot authorize model rights, enter measured geometry, prove heritage detail, or be presented as captured reality; it remains outside measured geometry.",
        evidenceRequirements: [
          requirement(
            "ai_source_rights",
            "Purpose-specific processing, training or inference, derivative, and publication rights for represented sources.",
            rightsState(aiRouteIds),
            aiRouteIds,
          ),
          requirement(
            "model_weight_rights",
            "Model-weight licence and allowed inference or training purpose.",
            "not_evaluated",
            [],
          ),
          requirement(
            "model_lineage",
            "Exact model, weight, condition, prompt, seed, environment, and source lineage.",
            "not_evaluated",
            [],
          ),
          requirement(
            "generated_region_controls",
            "Generated-region masks and reversible captured/generated display controls.",
            maskIds.length > 0 ? "present_unreviewed" : "not_evaluated",
            maskIds,
          ),
          requirement(
            "ai_fixed_view_review",
            "Frozen fixed-view and multi-view-consistency review against the captured sources.",
            presentState(fixedViewIds),
            fixedViewIds,
          ),
        ],
        likelyFailure:
          "The derivative may hallucinate structure, alter protected details, or look plausible in one view while failing elsewhere.",
        decisiveNextTest:
          "Run a bounded, rights-cleared, masked comparison and reject it if blinded fixed-view review finds changed factual detail or multi-view inconsistency.",
        alternatives: [
          "Real recapture with rights-cleared high-resolution photos or video remains the factual-detail alternative.",
        ],
      });
    }

    return {
      ...base,
      state: "available",
      cards,
      affectedAssets: [],
    };
  } catch (error: unknown) {
    if (
      error instanceof FoundryIntegrityError &&
      error.code === "PIPELINE_INPUT_UNROUTABLE_XGRIDS_XBIN"
    ) {
      return {
        ...base,
        state: "unavailable",
        reason: "xgrids_xbin_has_no_reviewed_route",
        cards: [],
        affectedAssets: representedAssets(
          manifest.assets
            .filter((asset) => asset.inputType === "xgrids_xbin")
            .map((asset) => asset.id),
        ),
        nextAction:
          "Request an official export in an open documented format or a vendor-supported route; do not decode XBIN here.",
      };
    }
    throw error;
  }
}

export async function startLocalFoundryApp(
  options: LocalFoundryAppOptions,
): Promise<LocalFoundryAppHandle> {
  const host = options.host ?? LOCAL_FOUNDRY_HOST;
  if (host !== LOCAL_FOUNDRY_HOST) {
    throw new Error("The Foundry local app can bind only to 127.0.0.1 (this computer).");
  }
  const source = options.source.trim();
  if (source.length === 0) throw new Error("Choose one source file or folder before starting the local app.");
  const requestedPort = options.port ?? 0;
  const sessionTtlMs = options.sessionTtlMs ?? LOCAL_FOUNDRY_DEFAULT_SESSION_TTL_MS;
  const offlinePreviewResponseChunkDelayMs =
    options.offlineNormalizationPreviewTestHooks?.responseChunkDelayMs ?? 0;
  validatePort(requestedPort);
  validateSessionTtl(sessionTtlMs);
  if (
    !Number.isInteger(offlinePreviewResponseChunkDelayMs) ||
    offlinePreviewResponseChunkDelayMs < 0 ||
    offlinePreviewResponseChunkDelayMs > 1_000 ||
    (
      offlinePreviewResponseChunkDelayMs > 0 &&
      process.env.NODE_ENV !== "test"
    )
  ) {
    throw new TypeError(
      "offline preview response pacing is available only to bounded tests",
    );
  }

  const sessionToken = randomBytes(32).toString("base64url");
  if (!SESSION_TOKEN_PATTERN.test(sessionToken)) {
    throw new Error("The local app session token does not meet the required security length.");
  }

  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + sessionTtlMs);
  let sourceLabel = safeSourceLabel(source);
  let phase: LocalFoundryAppPhase = "inspecting";
  let receipt: FoundryUniversalIntakeReceipt | undefined;
  let sourceFacts: FoundryUniversalSourceFactsV5 | undefined;
  let sourceReadiness: FoundrySourceReadinessMapV5 | undefined;
  let operatorEvidenceChecklist: FoundryOperatorEvidenceChecklistV5 | undefined;
  let admissionDraft: FoundryGuidedAdmissionDraft | undefined;
  let planPreview: FoundryPlanPreviewV0 | undefined;
  let trustedStartupSourceIdentity: ReferenceVerificationSourceIdentityV0 | undefined;
  let referenceVerification: LocalReferenceVerificationControllerV0 | undefined;
  const offlineNormalizationPreview =
    options.offlineNormalizationPreview === undefined
      ? undefined
      : createLocalOfflineNormalizationPreviewController(
          options.offlineNormalizationPreview,
        );
  let offlineNormalizationPreviewRequestId: string | undefined;
  let safeFailure: string | undefined;
  let boundPort = 0;
  let expectedHost = "";
  let origin = "";
  let stopPromise: Promise<void> | undefined;
  let stopRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingStopReason: LocalFoundryStopReason | undefined;
  let operatorStopPreparing = false;
  const inspectionAbort = new AbortController();
  let resolveClosed: ((value: LocalFoundryAppClosed) => void) | undefined;
  const closed = new Promise<LocalFoundryAppClosed>((resolvePromise) => {
    resolveClosed = resolvePromise;
  });
  let verificationTransition: Promise<void> = Promise.resolve();

  const serializeVerificationTransition = async <T>(
    operation: () => Promise<T>,
  ): Promise<T> => {
    const previous = verificationTransition;
    let release: (() => void) | undefined;
    verificationTransition = new Promise<void>((resolveTransition) => {
      release = resolveTransition;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  };

  const publicState = (): LocalFoundryPublicState => {
    const visiblePhase = phase === "stopped" ? "stopping" : phase;
    const progress = visiblePhase === "ready"
      ? { step: 3 as const, totalSteps: 3 as const, message: "The receipt is ready. No files are approved yet." }
      : visiblePhase === "failed"
        ? { step: 1 as const, totalSteps: 3 as const, message: "The check stopped without issuing a receipt." }
        : visiblePhase === "stopping"
          ? { step: 1 as const, totalSteps: 3 as const, message: "The local session is stopping." }
          : { step: 1 as const, totalSteps: 3 as const, message: "Reading files one at a time and calculating fingerprints. Large captures can take a while." };
    return {
      phase: visiblePhase,
      sourceLabel,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      progress,
      safety: {
        sourceAccess: "read_only",
        networkScope: "this_computer_only",
        uploads: "disabled",
        reconstruction: "disabled",
        admission: "draft_only",
        planning: "preview_only",
        execution: "disabled",
        authority: "none",
      },
      guidedWorkflow: {
        maximumFiles: LOCAL_FOUNDRY_MAX_GUIDED_FILES,
        admissionDraft: admissionDraft === undefined ? "not_built" : "ready",
        admissionReviewSha256: admissionDraft?.review.reviewSha256 ?? null,
        admissionResultSha256: admissionDraft?.result.resultSha256 ?? null,
        planPreview: planPreview === undefined ? "not_built" : "ready",
        planPreviewSha256: planPreview?.previewSha256 ?? null,
      },
      offlineNormalizationPreview:
        offlineNormalizationPreview === undefined
          ? structuredClone(LOCAL_OFFLINE_NORMALIZATION_PREVIEW_INITIAL_DTO)
          : offlineNormalizationPreviewRequestId !== undefined
            ? offlineNormalizationPreview.snapshot(
                offlineNormalizationPreviewRequestId,
              )
            : phase === "ready" && receipt !== undefined
              ? offlineNormalizationPreview.availability(
                  receipt.receiptSha256,
                )
              : structuredClone(
                  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_INITIAL_DTO,
                ),
      ...(safeFailure === undefined ? {} : { safeFailure }),
      ...(receipt === undefined ? {} : { receipt }),
      ...(sourceFacts === undefined ? {} : { sourceFacts }),
      ...(sourceReadiness === undefined ? {} : { sourceReadiness }),
      ...(operatorEvidenceChecklist === undefined
        ? {}
        : { operatorEvidenceChecklist }),
    };
  };

  const server = createServer((request, response) => {
    void (async () => {
      assertLoopbackSocket(request);
      assertHostAndOrigin(request, expectedHost, origin);
      let url: URL;
      try {
        url = new URL(request.url ?? "/", origin);
      } catch {
        throw new SafeHttpError(400, "The request address is invalid.");
      }
      const method = request.method ?? "GET";

      if (
        operatorStopPreparing &&
        url.pathname.startsWith("/api/") &&
        url.pathname !== "/api/state" &&
        url.pathname !== "/api/stop"
      ) {
        throw new SafeHttpError(409, "The local session is preparing to stop safely.");
      }

      if (method === "GET" && url.pathname === "/") {
        const queryEntries = [...url.searchParams.entries()];
        if (queryEntries.length > 0) requireSessionToken(url, sessionToken);
        send(response, 200, "text/html; charset=utf-8", LOCAL_FOUNDRY_APP_HTML);
        return;
      }
      if (method === "GET" && url.pathname === "/app.css") {
        assertNoQuery(url);
        send(response, 200, "text/css; charset=utf-8", LOCAL_FOUNDRY_APP_CSS);
        return;
      }
      if (method === "GET" && url.pathname === "/app.js") {
        assertNoQuery(url);
        send(response, 200, "text/javascript; charset=utf-8", LOCAL_FOUNDRY_APP_JAVASCRIPT);
        return;
      }
      if (method === "GET" && url.pathname === "/api/state") {
        requireSessionToken(url, sessionToken);
        sendJson(response, 200, publicState());
        return;
      }
      if (method === "GET" && url.pathname === "/api/receipt") {
        requireSessionToken(url, sessionToken);
        if (receipt === undefined || phase !== "ready") {
          throw new SafeHttpError(409, "The receipt is not ready yet.");
        }
        send(
          response,
          200,
          "application/json; charset=utf-8",
          `${JSON.stringify(receipt, null, 2)}\n`,
          {
            "Content-Disposition":
              "attachment; filename=\"foundry-universal-intake-receipt-v0.json\"",
          },
        );
        return;
      }
      if (method === "GET" && url.pathname === "/api/source-facts") {
        const requestedDigest = requireSourceFactsTokenAndDigest(url, sessionToken);
        if (sourceFacts === undefined || phase !== "ready") {
          throw new SafeHttpError(409, "The Source Facts artifact is not ready yet.");
        }
        if (requestedDigest !== sourceFacts.factsSha256) {
          throw new SafeHttpError(
            409,
            "That Source Facts artifact is no longer current. Refresh the local page before downloading.",
          );
        }
        send(
          response,
          200,
          "application/json; charset=utf-8",
          `${serializeUniversalSourceFactsV5Artifact(sourceFacts)}\n`,
          { "Content-Disposition": "attachment; filename=\"foundry-universal-source-facts-v5.json\"" },
        );
        return;
      }
      if (method === "GET" && url.pathname === "/api/source-readiness") {
        const requestedDigest = requireSourceReadinessTokenAndDigest(url, sessionToken);
        if (sourceReadiness === undefined || phase !== "ready") {
          throw new SafeHttpError(409, "The Source Readiness artifact is not ready yet.");
        }
        if (requestedDigest !== sourceReadiness.readinessSha256) {
          throw new SafeHttpError(
            409,
            "That Source Readiness artifact is no longer current. Refresh the local page before downloading.",
          );
        }
        send(
          response,
          200,
          "application/json; charset=utf-8",
          `${serializeFoundrySourceReadinessMapV5(sourceReadiness)}\n`,
          { "Content-Disposition": "attachment; filename=\"foundry-source-readiness-map-v5.json\"" },
        );
        return;
      }
      if (
        method === "GET" &&
        url.pathname === "/api/operator-evidence-checklist"
      ) {
        const requestedDigest = requireOperatorEvidenceChecklistTokenAndDigest(
          url,
          sessionToken,
        );
        if (operatorEvidenceChecklist === undefined || phase !== "ready") {
          throw new SafeHttpError(
            409,
            "The Operator Evidence Checklist is not ready yet.",
          );
        }
        if (requestedDigest !== operatorEvidenceChecklist.checklistSha256) {
          throw new SafeHttpError(
            409,
            "That Operator Evidence Checklist is no longer current. Refresh the local page before downloading.",
          );
        }
        send(
          response,
          200,
          "application/json; charset=utf-8",
          `${serializeFoundryOperatorEvidenceChecklistV5(operatorEvidenceChecklist)}\n`,
          {
            "Content-Disposition":
              "attachment; filename=\"foundry-operator-evidence-checklist-v5.json\"",
          },
        );
        return;
      }
      if (method === "POST" && url.pathname === "/api/admission-draft") {
        requireSessionToken(url, sessionToken);
        if (request.headers.origin !== origin) {
          throw new SafeHttpError(403, "The draft request must come from this local app.");
        }
        if (receipt === undefined || phase !== "ready") {
          throw new SafeHttpError(409, "The receipt is not ready for review.");
        }
        if (receipt.files.length > LOCAL_FOUNDRY_MAX_GUIDED_FILES) {
          throw new SafeHttpError(
            409,
            `This guided screen supports at most ${String(LOCAL_FOUNDRY_MAX_GUIDED_FILES)} files. Download the complete receipt and give it to the project's authorized capture reviewer so no file is silently omitted.`,
          );
        }
        const body = await readJsonObject(
          request,
          LOCAL_FOUNDRY_MAX_DRAFT_BODY_BYTES,
          "The admission draft request",
        );
        assertExactKeys(
          body,
          [
            "receiptSha256",
            "projectId",
            "reviewedBy",
            "sourceMedia",
            "caseSensitivity",
            "decisions",
          ],
          "The admission draft request",
        );
        let compiled: FoundryGuidedAdmissionDraft;
        try {
          compiled = compileGuidedAdmissionDraft(receipt, {
            schemaVersion: FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
            receiptSha256: body.receiptSha256,
            projectId: body.projectId,
            reviewedAt: new Date().toISOString(),
            reviewedBy: body.reviewedBy,
            sourceMedia: body.sourceMedia,
            caseSensitivity: body.caseSensitivity,
            decisions: body.decisions,
          });
        } catch (error: unknown) {
          throw new SafeHttpError(
            400,
            error instanceof FoundryIntegrityError
              ? error.message
              : "The choices could not be turned into a safe review draft. No file was changed.",
          );
        }
        await serializeVerificationTransition(async () => {
          if (phase !== "ready") {
            throw new SafeHttpError(409, "The local session is no longer ready for a new review draft.");
          }
          if (
            referenceVerification !== undefined &&
            !(await referenceVerification.canDetachForNewAdmission())
          ) {
            throw new SafeHttpError(
              409,
              "Stop the approved-file check before changing the review draft.",
            );
          }
          if (referenceVerification !== undefined) {
            await referenceVerification.shutdown();
            referenceVerification = undefined;
          }
          admissionDraft = compiled;
          planPreview = undefined;
        });
        sendJson(response, 201, {
          receiptSha256: compiled.result.receiptSha256,
          reviewSha256: compiled.review.reviewSha256,
          resultSha256: compiled.result.resultSha256,
          manifestSha256: compiled.result.manifestSha256,
          admittedFileCount: compiled.result.manifest.assets.length,
          excludedFileCount: compiled.result.exclusions.length,
          legalReviewState: compiled.review.legalReviewState,
          authority: compiled.review.authority,
          execution: compiled.review.capabilities.execution,
        });
        return;
      }
      if (method === "GET" && url.pathname === "/api/admission-review") {
        const requestedDigest = requireArtifactTokenAndDigest(url, sessionToken);
        if (admissionDraft === undefined || phase !== "ready") {
          throw new SafeHttpError(409, "Build the review draft before downloading it.");
        }
        if (requestedDigest !== admissionDraft.review.reviewSha256) {
          throw new SafeHttpError(
            409,
            "That review draft is no longer current. Rebuild it before downloading.",
          );
        }
        send(
          response,
          200,
          "application/json; charset=utf-8",
          `${JSON.stringify(admissionDraft.review, null, 2)}\n`,
          { "Content-Disposition": "attachment; filename=\"foundry-admission-review-draft.json\"" },
        );
        return;
      }
      if (method === "GET" && url.pathname === "/api/admission-result") {
        const requestedDigest = requireArtifactTokenAndDigest(url, sessionToken);
        if (admissionDraft === undefined || phase !== "ready") {
          throw new SafeHttpError(409, "Build the review draft before downloading its result.");
        }
        if (requestedDigest !== admissionDraft.result.resultSha256) {
          throw new SafeHttpError(
            409,
            "That result draft is no longer current. Rebuild it before downloading.",
          );
        }
        send(
          response,
          200,
          "application/json; charset=utf-8",
          `${JSON.stringify(admissionDraft.result, null, 2)}\n`,
          { "Content-Disposition": "attachment; filename=\"foundry-admission-result-draft.json\"" },
        );
        return;
      }
      if (method === "POST" && url.pathname === "/api/reference-verification/start") {
        requireSessionToken(url, sessionToken);
        requireSameOriginPost(request, origin);
        const body = await readJsonObject(
          request,
          LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
          "The approved-file check request",
        );
        assertRequiredExactKeys(
          body,
          ["admissionResultSha256", "requestId"],
          "The approved-file check request",
        );
        const admissionResultSha256 = parseVerificationAdmissionDigest(
          body.admissionResultSha256,
        );
        const requestId = parseVerificationRequestId(body.requestId);
        let publicVerification: LocalReferenceVerificationPublicV0;
        try {
          publicVerification = await serializeVerificationTransition(async () => {
            if (
              phase !== "ready" ||
              receipt === undefined ||
              admissionDraft === undefined ||
              trustedStartupSourceIdentity === undefined ||
              admissionDraft.result.resultSha256 !== admissionResultSha256
            ) {
              throw safeVerificationRouteFailure("start");
            }
            if (referenceVerification === undefined) {
              referenceVerification = await LocalReferenceVerificationControllerV0.create({
                source,
                trustedStartupSourceIdentity,
                receipt,
                admissionDraft,
                ...(options.privateStateRoot === undefined
                  ? {}
                  : { privateStateRoot: options.privateStateRoot }),
                ...(options.referenceVerificationTestHooks === undefined
                  ? {}
                  : { testHooks: options.referenceVerificationTestHooks }),
              });
            }
            if (referenceVerification.admissionResultSha256 !== admissionResultSha256) {
              throw safeVerificationRouteFailure("start");
            }
            return referenceVerification.start(admissionResultSha256, requestId);
          });
        } catch (error: unknown) {
          if (error instanceof SafeHttpError) throw error;
          throw safeVerificationRouteFailure("start");
        }
        sendJson(response, 202, publicVerification);
        return;
      }
      if (method === "POST" && url.pathname === "/api/reference-verification/status") {
        requireSessionToken(url, sessionToken);
        requireSameOriginPost(request, origin);
        const body = await readJsonObject(
          request,
          LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
          "The approved-file check status request",
        );
        assertRequiredExactKeys(body, ["jobId", "revision", "run"], "The approved-file check status request");
        const job = parseVerificationJobReference(body);
        try {
          const publicVerification = await serializeVerificationTransition(async () => {
            if (phase !== "ready" || referenceVerification === undefined) {
              throw safeVerificationRouteFailure("status");
            }
            return referenceVerification.status(job.jobId, job.revision, job.run);
          });
          sendJson(response, 200, publicVerification);
        } catch (error: unknown) {
          if (error instanceof SafeHttpError) throw error;
          throw safeVerificationRouteFailure("status");
        }
        return;
      }
      if (method === "POST" && url.pathname === "/api/reference-verification/current") {
        requireSessionToken(url, sessionToken);
        requireSameOriginPost(request, origin);
        const body = await readJsonObject(
          request,
          LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
          "The current approved-file check request",
        );
        assertRequiredExactKeys(body, [], "The current approved-file check request");
        try {
          const current = await serializeVerificationTransition(async () => {
            if (phase !== "ready") throw safeVerificationRouteFailure("status");
            return referenceVerification === undefined
              ? null
              : referenceVerification.current();
          });
          sendJson(response, 200, { current });
        } catch (error: unknown) {
          if (error instanceof SafeHttpError) throw error;
          throw safeVerificationRouteFailure("status");
        }
        return;
      }
      if (method === "POST" && url.pathname === "/api/reference-verification/cancel") {
        requireSessionToken(url, sessionToken);
        requireSameOriginPost(request, origin);
        const body = await readJsonObject(
          request,
          LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
          "The stop-approved-file-check request",
        );
        assertRequiredExactKeys(body, ["jobId", "revision", "run"], "The stop-approved-file-check request");
        const job = parseVerificationJobReference(body);
        try {
          const publicVerification = await serializeVerificationTransition(async () => {
            if (phase !== "ready" || referenceVerification === undefined) {
              throw safeVerificationRouteFailure("cancel");
            }
            return referenceVerification.cancel(job.jobId, job.revision, job.run);
          });
          sendJson(response, 200, publicVerification);
        } catch (error: unknown) {
          if (error instanceof SafeHttpError) throw error;
          throw safeVerificationRouteFailure("cancel");
        }
        return;
      }
      if (method === "POST" && url.pathname === "/api/reference-verification/resume") {
        requireSessionToken(url, sessionToken);
        requireSameOriginPost(request, origin);
        const body = await readJsonObject(
          request,
          LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
          "The restart-approved-file-check request",
        );
        assertRequiredExactKeys(
          body,
          ["jobId", "revision", "run", "admissionResultSha256", "requestId"],
          "The restart-approved-file-check request",
        );
        const job = parseVerificationJobReference(body);
        const admissionResultSha256 = parseVerificationAdmissionDigest(
          body.admissionResultSha256,
        );
        const requestId = parseVerificationRequestId(body.requestId);
        try {
          const publicVerification = await serializeVerificationTransition(async () => {
            if (
              phase !== "ready" ||
              admissionDraft === undefined ||
              referenceVerification === undefined ||
              admissionDraft.result.resultSha256 !== admissionResultSha256
            ) {
              throw safeVerificationRouteFailure("resume");
            }
            return referenceVerification.resume(
              job.jobId,
              job.revision,
              job.run,
              admissionResultSha256,
              requestId,
            );
          });
          sendJson(response, 202, publicVerification);
        } catch (error: unknown) {
          if (error instanceof SafeHttpError) throw error;
          throw safeVerificationRouteFailure("resume");
        }
        return;
      }
      if (method === "POST" && url.pathname === "/api/reference-verification/report") {
        requireSessionToken(url, sessionToken);
        requireSameOriginPost(request, origin);
        const body = await readJsonObject(
          request,
          LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
          "The approved-file report request",
        );
        assertRequiredExactKeys(body, ["jobId", "revision", "run"], "The approved-file report request");
        const job = parseVerificationJobReference(body);
        try {
          const publicVerification = await serializeVerificationTransition(async () => {
            if (phase !== "ready" || referenceVerification === undefined) {
              throw safeVerificationRouteFailure("report");
            }
            return referenceVerification.report(job.jobId, job.revision, job.run);
          });
          sendJson(response, 200, publicVerification);
        } catch (error: unknown) {
          if (error instanceof SafeHttpError) throw error;
          throw safeVerificationRouteFailure("report");
        }
        return;
      }
      if (
        method === "POST" &&
        url.pathname === "/api/offline-normalization-preview/start"
      ) {
        requireSessionToken(url, sessionToken);
        requireSameOriginPost(request, origin);
        const body = await readJsonObject(
          request,
          LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
          "The private offline preview request",
        );
        const previewRequest = parseOfflinePreviewStartRequest(body);
        if (
          phase !== "ready" ||
          receipt === undefined ||
          receipt.receiptSha256 !== previewRequest.receiptSha256 ||
          offlineNormalizationPreview === undefined
        ) {
          throw new SafeHttpError(
            409,
            "No trusted private offline preview is ready for this exact receipt.",
          );
        }
        if (
          offlineNormalizationPreviewRequestId !== undefined &&
          offlineNormalizationPreviewRequestId !== previewRequest.requestId
        ) {
          throw new SafeHttpError(
            409,
            "A different private preview request already owns this local session.",
          );
        }
        const prepared = offlineNormalizationPreview.prepare(previewRequest);
        if (prepared.state !== "ready") {
          sendJson(response, 200, prepared);
          return;
        }
        offlineNormalizationPreviewRequestId = previewRequest.requestId;
        const run = offlineNormalizationPreview.start(previewRequest);
        void run.catch(() => undefined);
        sendJson(
          response,
          202,
          offlineNormalizationPreview.snapshot(previewRequest.requestId),
        );
        return;
      }
      if (
        method === "POST" &&
        url.pathname === "/api/offline-normalization-preview/status"
      ) {
        requireSessionToken(url, sessionToken);
        requireSameOriginPost(request, origin);
        const body = await readJsonObject(
          request,
          LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
          "The private offline preview status request",
        );
        assertRequiredExactKeys(
          body,
          ["requestId"],
          "The private offline preview status request",
        );
        const requestId = parseOfflinePreviewRequestId(body.requestId);
        if (
          offlineNormalizationPreview === undefined ||
          offlineNormalizationPreviewRequestId !== requestId
        ) {
          throw new SafeHttpError(409, "That private preview request is no longer current.");
        }
        const current = offlineNormalizationPreview.status(requestId);
        if (current === null) {
          throw new SafeHttpError(409, "That private preview request is no longer current.");
        }
        sendJson(response, 200, current);
        return;
      }
      if (
        method === "POST" &&
        url.pathname === "/api/offline-normalization-preview/cancel"
      ) {
        requireSessionToken(url, sessionToken);
        requireSameOriginPost(request, origin);
        const body = await readJsonObject(
          request,
          LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
          "The stop-private-preview request",
        );
        assertRequiredExactKeys(
          body,
          ["requestId"],
          "The stop-private-preview request",
        );
        const requestId = parseOfflinePreviewRequestId(body.requestId);
        if (
          offlineNormalizationPreview === undefined ||
          offlineNormalizationPreviewRequestId !== requestId
        ) {
          throw new SafeHttpError(409, "That private preview request is no longer current.");
        }
        const current = await offlineNormalizationPreview.cancel(requestId);
        if (current === null) {
          throw new SafeHttpError(409, "That private preview request is no longer current.");
        }
        sendJson(response, 200, current);
        return;
      }
      if (
        method === "GET" &&
        url.pathname === "/api/offline-normalization-preview/output"
      ) {
        const artifactRequest = requireOfflinePreviewArtifactToken(
          url,
          sessionToken,
        );
        if (
          offlineNormalizationPreview === undefined ||
          offlineNormalizationPreviewRequestId !== artifactRequest.requestId
        ) {
          throw new SafeHttpError(409, "That private preview output is no longer current.");
        }
        const report = offlineNormalizationPreview.readVerifiedReport(
          artifactRequest.requestId,
        );
        if (report === null) {
          throw new SafeHttpError(409, "The verified private preview output is not available.");
        }
        if (artifactRequest.digest !== report.output.sha256) {
          throw new SafeHttpError(409, "That private preview output fingerprint is no longer current.");
        }
        const lease = offlineNormalizationPreview.acquireVerifiedOutput(
          artifactRequest.requestId,
          artifactRequest.digest,
          () => {
            response.destroy();
          },
        );
        if (lease === null) {
          throw new SafeHttpError(
            409,
            "That private preview output is already being sent or is no longer available.",
          );
        }
        try {
          sendBytes(
            response,
            200,
            "model/gltf-binary",
            lease.normalizedGlb,
            {
              "Content-Disposition":
                "attachment; filename=\"foundry-private-offline-format-preview.glb\"",
            },
            () => {
              lease.release();
            },
            offlinePreviewResponseChunkDelayMs,
          );
        } catch (error: unknown) {
          lease.release();
          throw error;
        }
        return;
      }
      if (
        method === "GET" &&
        url.pathname === "/api/offline-normalization-preview/report"
      ) {
        const artifactRequest = requireOfflinePreviewArtifactToken(
          url,
          sessionToken,
        );
        if (
          offlineNormalizationPreview === undefined ||
          offlineNormalizationPreviewRequestId !== artifactRequest.requestId
        ) {
          throw new SafeHttpError(409, "That private preview report is no longer current.");
        }
        const report = offlineNormalizationPreview.readVerifiedReport(
          artifactRequest.requestId,
        );
        if (report === null) {
          throw new SafeHttpError(409, "The verified private preview report is not available.");
        }
        if (artifactRequest.digest !== report.reportSha256) {
          throw new SafeHttpError(409, "That private preview report fingerprint is no longer current.");
        }
        send(
          response,
          200,
          "application/json; charset=utf-8",
          `${JSON.stringify(report, null, 2)}\n`,
          {
            "Content-Disposition":
              "attachment; filename=\"foundry-private-offline-format-preview-report.json\"",
          },
        );
        return;
      }
      if (method === "POST" && url.pathname === "/api/plan-preview") {
        requireSessionToken(url, sessionToken);
        if (request.headers.origin !== origin) {
          throw new SafeHttpError(403, "The plan request must come from this local app.");
        }
        if (admissionDraft === undefined || phase !== "ready") {
          throw new SafeHttpError(409, "Build the review draft before comparing plans.");
        }
        const body = await readJsonObject(
          request,
          LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
          "The plan preview request",
        );
        assertExactKeys(
          body,
          [
            "hdAppearance",
            "includeSemanticInference",
            "buildOperationalMesh",
            "buildNeuralRepresentation",
            "admissionResultSha256",
          ],
          "The plan preview request",
        );
        const requestedAdmissionDigest = RuntimeSha256Schema.safeParse(
          body.admissionResultSha256,
        );
        if (
          !requestedAdmissionDigest.success ||
          requestedAdmissionDigest.data !== admissionDraft.result.resultSha256
        ) {
          throw new SafeHttpError(
            409,
            "The review draft changed. Build a new plan preview from the current draft.",
          );
        }
        let responsePayload: LocalFoundryPlanPreviewResponseV0;
        try {
          const compiled = compileFoundryPlanPreview({
            id: "local-plan-preview-v0",
            displayName: "Local reconstruction planning preview",
            createdAt: new Date().toISOString(),
            admissionResult: admissionDraft.result,
            manifest: admissionDraft.result.manifest,
            options: {
              hdAppearance: body.hdAppearance,
              includeSemanticInference: body.includeSemanticInference,
              buildOperationalMesh: body.buildOperationalMesh,
              buildNeuralRepresentation: body.buildNeuralRepresentation,
            },
            workerBindings: [],
            localRoutes: [
              {
                providerKind: "local_cpu",
                providerAdapterId: "unmeasured-local-cpu-v0",
                capacity: null,
              },
              {
                providerKind: "local_cuda",
                providerAdapterId: "unmeasured-local-cuda-v0",
                capacity: null,
              },
            ],
            remoteRoutes: [
              {
                providerKind: "runpod",
                providerAdapterId: "unconfigured-runpod-v0",
                objectStorageProfile: "not-configured-v0",
                capacity: null,
                estimateSnapshot: null,
              },
            ],
          });
          responsePayload = {
            preview: compiled,
            processingOutline: compileLocalFoundryProcessingOutlineV0(
              admissionDraft.result.manifest,
              compiled.options,
            ),
            qualityDecisionBoard: compileLocalFoundryQualityDecisionBoardV0(
              admissionDraft.result.manifest,
              compiled.options,
            ),
          };
        } catch (error: unknown) {
          throw new SafeHttpError(
            400,
            error instanceof FoundryIntegrityError
              ? error.message
              : "The safe plan preview could not be built. Nothing ran and no provider was contacted.",
          );
        }
        planPreview = responsePayload.preview;
        sendJson(response, 201, responsePayload);
        return;
      }
      if (method === "GET" && url.pathname === "/api/plan-dossier") {
        const requestedDigest = requireArtifactTokenAndDigest(url, sessionToken);
        if (planPreview === undefined || phase !== "ready") {
          throw new SafeHttpError(409, "Build the plan preview before downloading it.");
        }
        if (requestedDigest !== planPreview.previewSha256) {
          throw new SafeHttpError(
            409,
            "That plan preview is no longer current. Build it again before downloading.",
          );
        }
        send(
          response,
          200,
          "application/json; charset=utf-8",
          `${JSON.stringify(planPreview, null, 2)}\n`,
          { "Content-Disposition": "attachment; filename=\"foundry-plan-preview.json\"" },
        );
        return;
      }
      if (method === "POST" && url.pathname === "/api/stop") {
        requireSessionToken(url, sessionToken);
        requireSameOriginPost(request, origin);
        await readEmptyJsonObject(request);
        if (operatorStopPreparing) {
          throw new SafeHttpError(409, "The local session is already preparing to stop safely.");
        }
        operatorStopPreparing = true;
        const phaseBeforeStop = phase;
        phase = "stopping";
        try {
          await serializeVerificationTransition(async () => {
            if (referenceVerification !== undefined) {
              await referenceVerification.shutdown();
              referenceVerification = undefined;
            }
          });
          if (offlineNormalizationPreview !== undefined) {
            await offlineNormalizationPreview.stop();
          }
        } catch {
          operatorStopPreparing = false;
          phase = phaseBeforeStop;
          throw new SafeHttpError(
            409,
            "The local work could not confirm a safe stop. The session is still open; check its state and try again.",
          );
        }
        clearTimeout(expiryTimer);
        sendJson(response, 202, {
          stopping: true,
          verificationStopped: true,
          offlinePreviewStopped: true,
        });
        setImmediate(() => {
          void stopServer("operator");
        });
        return;
      }
      if (
        [
          "/",
          "/api/state",
          "/api/receipt",
          "/api/source-facts",
          "/api/source-readiness",
          "/api/operator-evidence-checklist",
          "/api/admission-draft",
          "/api/admission-review",
          "/api/admission-result",
          "/api/reference-verification/start",
          "/api/reference-verification/status",
          "/api/reference-verification/current",
          "/api/reference-verification/cancel",
          "/api/reference-verification/resume",
          "/api/reference-verification/report",
          "/api/offline-normalization-preview/start",
          "/api/offline-normalization-preview/status",
          "/api/offline-normalization-preview/cancel",
          "/api/offline-normalization-preview/output",
          "/api/offline-normalization-preview/report",
          "/api/plan-preview",
          "/api/plan-dossier",
          "/api/stop",
        ].includes(url.pathname)
      ) {
        throw new SafeHttpError(405, "This request method is not allowed.");
      }
      throw new SafeHttpError(404, "This local app route does not exist.");
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendError(
        response,
        error instanceof SafeHttpError
          ? error
          : new SafeHttpError(500, "The local app stopped this request safely."),
      );
    });
  });

  const stopServer = (reason: LocalFoundryStopReason): Promise<void> => {
    if (stopPromise !== undefined) return stopPromise;
    if (stopRetryTimer !== undefined) {
      clearTimeout(stopRetryTimer);
      stopRetryTimer = undefined;
    }
    pendingStopReason ??= reason;
    const confirmedStopReason = pendingStopReason;
    phase = "stopping";
    inspectionAbort.abort();
    clearTimeout(expiryTimer);
    const attempt = (async () => {
      await serializeVerificationTransition(async () => {
        if (referenceVerification !== undefined) {
          await referenceVerification.shutdown();
          referenceVerification = undefined;
        }
      });
      if (offlineNormalizationPreview !== undefined) {
        await offlineNormalizationPreview.stop();
      }
      await new Promise<void>((resolveClose) => {
        server.close(() => {
          resolveClose();
        });
        server.closeIdleConnections();
        server.closeAllConnections();
      });
      receipt = undefined;
      sourceFacts = undefined;
      sourceReadiness = undefined;
      operatorEvidenceChecklist = undefined;
      admissionDraft = undefined;
      planPreview = undefined;
      trustedStartupSourceIdentity = undefined;
      offlineNormalizationPreviewRequestId = undefined;
      safeFailure = undefined;
      phase = "stopped";
      resolveClosed?.({ reason: confirmedStopReason });
    })();
    stopPromise = attempt;
    void attempt.catch(() => {
      if (stopPromise === attempt) stopPromise = undefined;
      if (phase === "stopped" || stopRetryTimer !== undefined) return;
      stopRetryTimer = setTimeout(() => {
        stopRetryTimer = undefined;
        void stopServer(confirmedStopReason).catch(() => {
          // The failed attempt schedules the next bounded retry.
        });
      }, SAFE_STOP_RETRY_MS);
      stopRetryTimer.unref();
    });
    return attempt;
  };

  try {
    boundPort = await listen(server, requestedPort);
  } catch (error: unknown) {
    server.close();
    throw error;
  }
  expectedHost = `${LOCAL_FOUNDRY_HOST}:${String(boundPort)}`;
  origin = `http://${expectedHost}`;

  const stopExpiredSession = (): void => {
    void stopServer("session_expired").catch(() => {
      // stopServer keeps every failed stop retryable and schedules the next
      // bounded attempt. This callback only prevents an unhandled rejection.
    });
  };
  const expiryTimer = setTimeout(stopExpiredSession, sessionTtlMs);

  void captureReferenceVerificationSourceIdentityV0(source)
    .then(async (identity) => {
      if (phase !== "inspecting") return undefined;
      trustedStartupSourceIdentity = identity;
      return inspectUniversalIntakeWithSourceFactsV5(source, { signal: inspectionAbort.signal });
    })
    .then((candidate) => {
      if (candidate === undefined) return;
      if (phase !== "inspecting") return;
      const parsedReceipt = FoundryUniversalIntakeReceiptSchema.parse(candidate.receipt);
      const parsedSourceFacts = FoundryUniversalSourceFactsV5Schema.parse(candidate.sourceFacts);
      const parsedSourceReadiness = FoundrySourceReadinessMapV5Schema.parse(
        compileFoundrySourceReadinessMapV5({
          receipt: parsedReceipt,
          sourceFacts: parsedSourceFacts,
        }),
      );
      const parsedOperatorEvidenceChecklist =
        FoundryOperatorEvidenceChecklistV5Schema.parse(
          compileFoundryOperatorEvidenceChecklistV5({
            readiness: parsedSourceReadiness,
          }),
        );
      receipt = parsedReceipt;
      sourceFacts = parsedSourceFacts;
      sourceReadiness = parsedSourceReadiness;
      operatorEvidenceChecklist = parsedOperatorEvidenceChecklist;
      sourceLabel = parsedReceipt.source.label;
      phase = "ready";
    })
    .catch(() => {
      if (phase !== "inspecting") return;
      safeFailure = safeInspectionFailure();
      phase = "failed";
    });

  return {
    host: LOCAL_FOUNDRY_HOST,
    port: boundPort,
    origin,
    url: `${origin}/?token=${encodeURIComponent(sessionToken)}`,
    sourceLabel,
    closed,
    stop: async () => stopServer("programmatic"),
    getPhase: () => phase,
  };
}

export interface BrowserLaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
}

export function localFoundryBrowserLaunchSpec(
  urlText: string,
  platform: NodeJS.Platform = process.platform,
): BrowserLaunchSpec {
  const url = new URL(urlText);
  const tokenEntries = [...url.searchParams.entries()];
  if (
    url.protocol !== "http:" ||
    url.hostname !== LOCAL_FOUNDRY_HOST ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    tokenEntries.length !== 1 ||
    tokenEntries[0]?.[0] !== "token" ||
    !SESSION_TOKEN_PATTERN.test(tokenEntries[0][1])
  ) {
    throw new Error("Refusing to open a browser for an invalid local Foundry URL.");
  }
  if (platform === "win32") {
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url.toString()] };
  }
  if (platform === "darwin") return { command: "open", args: [url.toString()] };
  return { command: "xdg-open", args: [url.toString()] };
}

export type BrowserProcessLauncher = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => Pick<ChildProcess, "once" | "unref">;

const defaultBrowserProcessLauncher: BrowserProcessLauncher = (command, args, options) =>
  spawn(command, [...args], options);

export function openLocalFoundryAppInBrowser(
  url: string,
  launcher: BrowserProcessLauncher = defaultBrowserProcessLauncher,
): void {
  const spec = localFoundryBrowserLaunchSpec(url);
  const child = launcher(spec.command, spec.args, {
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  child.once("error", () => undefined);
  child.unref();
}
