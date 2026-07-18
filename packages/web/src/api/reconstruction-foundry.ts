import {
  ReconstructionCandidateVerificationInputSchema,
  ReconstructionReviewEvidenceArtifactListSchema,
  ReconstructionReviewEvidenceArtifactRegistrationInputSchema,
  ReconstructionReviewEvidenceArtifactSchema,
  ReconstructionReleaseAttestationMetadataSchema,
  ReconstructionReleaseAttestationVerificationInputSchema,
  ReconstructionReleaseChannelConflictSchema,
  ReconstructionReleaseChannelEventSchema,
  ReconstructionReleaseChannelSchema,
  ReconstructionReleaseDetailSchema,
  ReconstructionReleaseListSchema,
  ReconstructionReleasePromoteInputSchema,
  ReconstructionReleasePublicationInputSchema,
  ReconstructionReleasePublicationSchema,
  ReconstructionReleaseRegistrationSchema,
  ReconstructionReleaseReviewInputSchema,
  ReconstructionReleaseReviewSchema,
  ReconstructionReleaseRollbackInputSchema,
  ReconstructionReleaseSigningPayloadSchema,
} from "@omnitwin/types";
import type { z } from "zod";
import { API_URL } from "../config/env.js";
import { ApiError, api, getAuthToken } from "./client.js";

const FOUNDRY_BASE = "/admin/reconstruction-foundry";
const RELEASE_KIND = "venue_twin_v1";

type ReleaseList = z.infer<typeof ReconstructionReleaseListSchema>;
type ReleaseDetail = z.infer<typeof ReconstructionReleaseDetailSchema>;
type CandidateVerificationInput = z.input<typeof ReconstructionCandidateVerificationInputSchema>;
type ReleaseRegistration = z.infer<typeof ReconstructionReleaseRegistrationSchema>;
type AttestationMetadata = z.infer<typeof ReconstructionReleaseAttestationMetadataSchema>;
interface AttestationVerificationDraft {
  readonly reviewId: string;
  readonly envelope: unknown;
  readonly idempotencyKey: string;
}
type AttestationVerificationInput = z.infer<typeof ReconstructionReleaseAttestationVerificationInputSchema>;
type SigningPayload = z.infer<typeof ReconstructionReleaseSigningPayloadSchema>;
type ReviewInput = z.input<typeof ReconstructionReleaseReviewInputSchema>;
type ReviewResult = z.infer<typeof ReconstructionReleaseReviewSchema>;
type PublicationInput = z.input<typeof ReconstructionReleasePublicationInputSchema>;
type PublicationRecord = z.infer<typeof ReconstructionReleasePublicationSchema>;
type ProductionChannel = z.infer<typeof ReconstructionReleaseChannelSchema>;
type ChannelEvent = z.infer<typeof ReconstructionReleaseChannelEventSchema>;
type ChannelConflict = z.infer<typeof ReconstructionReleaseChannelConflictSchema>;
type PromoteInput = z.input<typeof ReconstructionReleasePromoteInputSchema>;
type RollbackInput = z.input<typeof ReconstructionReleaseRollbackInputSchema>;
type ReviewEvidenceArtifactList = z.infer<typeof ReconstructionReviewEvidenceArtifactListSchema>;
type ReviewEvidenceArtifact = z.infer<typeof ReconstructionReviewEvidenceArtifactSchema>;
type ReviewEvidenceArtifactRegistrationInput = z.input<typeof ReconstructionReviewEvidenceArtifactRegistrationInputSchema>;

function productionChannelQuery(venueSlug: string): string {
  return new URLSearchParams({ venueSlug, releaseKind: RELEASE_KIND }).toString();
}

export async function listReconstructionReleases(
  venueSlug: string,
  signal?: AbortSignal,
): Promise<ReleaseList> {
  const query = new URLSearchParams({ venueSlug }).toString();
  return api.get(`${FOUNDRY_BASE}/releases?${query}`, ReconstructionReleaseListSchema, signal);
}

export async function listReconstructionReviewEvidenceArtifacts(
  venueSlug: string,
  signal?: AbortSignal,
): Promise<ReviewEvidenceArtifactList> {
  const query = new URLSearchParams({ venueSlug }).toString();
  return api.get(
    `${FOUNDRY_BASE}/evidence-artifacts?${query}`,
    ReconstructionReviewEvidenceArtifactListSchema,
    signal,
  );
}

export async function registerReconstructionReviewEvidenceArtifact(
  input: ReviewEvidenceArtifactRegistrationInput,
): Promise<ReviewEvidenceArtifact> {
  return api.post(
    `${FOUNDRY_BASE}/evidence-artifacts`,
    ReconstructionReviewEvidenceArtifactRegistrationInputSchema.parse(input),
    false,
    ReconstructionReviewEvidenceArtifactSchema,
  );
}

export async function fetchReconstructionVisualEvidence(
  releaseId: string,
  path: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const query = new URLSearchParams({ path }).toString();
  const response = await fetch(
    `${API_URL}${FOUNDRY_BASE}/releases/${encodeURIComponent(releaseId)}/visual-evidence?${query}`,
    { headers, signal, cache: "no-store" },
  );
  if (!response.ok) {
    let message = "Visual evidence could not be opened.";
    try {
      const raw = await response.json() as unknown;
      if (
        typeof raw === "object" && raw !== null && !Array.isArray(raw) &&
        "error" in raw && typeof raw.error === "string"
      ) message = raw.error;
    } catch {
      // Preserve the safe generic message for non-JSON failures.
    }
    throw new ApiError(response.status, message, "VISUAL_EVIDENCE_UNAVAILABLE");
  }
  return response.blob();
}

export async function getReconstructionRelease(
  releaseId: string,
  signal?: AbortSignal,
): Promise<ReleaseDetail> {
  return api.get(
    `${FOUNDRY_BASE}/releases/${encodeURIComponent(releaseId)}`,
    ReconstructionReleaseDetailSchema,
    signal,
  );
}

export async function verifyReconstructionCandidate(
  input: CandidateVerificationInput,
): Promise<ReleaseRegistration> {
  return api.post(
    `${FOUNDRY_BASE}/releases/verify-candidate`,
    ReconstructionCandidateVerificationInputSchema.parse(input),
    false,
    ReconstructionReleaseRegistrationSchema,
  );
}

export async function reviewReconstructionRelease(
  releaseId: string,
  input: ReviewInput,
): Promise<ReviewResult> {
  return api.post(
    `${FOUNDRY_BASE}/releases/${encodeURIComponent(releaseId)}/reviews`,
    ReconstructionReleaseReviewInputSchema.parse(input),
    false,
    ReconstructionReleaseReviewSchema,
  );
}

export async function getReconstructionReleaseSigningPayload(
  releaseId: string,
  reviewId: string,
  signal?: AbortSignal,
): Promise<SigningPayload> {
  const query = new URLSearchParams({ reviewId }).toString();
  return api.get(
    `${FOUNDRY_BASE}/releases/${encodeURIComponent(releaseId)}/signing-payload?${query}`,
    ReconstructionReleaseSigningPayloadSchema,
    signal,
  );
}

export async function verifyReconstructionReleaseAttestation(
  releaseId: string,
  input: AttestationVerificationDraft,
): Promise<AttestationMetadata> {
  return api.post(
    `${FOUNDRY_BASE}/releases/${encodeURIComponent(releaseId)}/attestations/verify`,
    ReconstructionReleaseAttestationVerificationInputSchema.parse(input),
    false,
    ReconstructionReleaseAttestationMetadataSchema,
  );
}

export async function publishReconstructionRelease(
  releaseId: string,
  input: PublicationInput,
): Promise<PublicationRecord> {
  return api.post(
    `${FOUNDRY_BASE}/releases/${encodeURIComponent(releaseId)}/publish`,
    ReconstructionReleasePublicationInputSchema.parse(input),
    false,
    ReconstructionReleasePublicationSchema,
  );
}

export async function getProductionReconstructionChannel(
  venueSlug: string,
  signal?: AbortSignal,
): Promise<ProductionChannel | null> {
  return api.get(
    `${FOUNDRY_BASE}/channels/production?${productionChannelQuery(venueSlug)}`,
    ReconstructionReleaseChannelSchema.nullable(),
    signal,
  );
}

export async function getProductionReconstructionHistory(
  venueSlug: string,
  signal?: AbortSignal,
): Promise<readonly ChannelEvent[]> {
  return api.get(
    `${FOUNDRY_BASE}/channels/production/history?${productionChannelQuery(venueSlug)}`,
    ReconstructionReleaseChannelEventSchema.array(),
    signal,
  );
}

export async function promoteReconstructionRelease(input: PromoteInput): Promise<ChannelEvent> {
  return api.post(
    `${FOUNDRY_BASE}/channels/production/promote`,
    ReconstructionReleasePromoteInputSchema.parse(input),
    false,
    ReconstructionReleaseChannelEventSchema,
  );
}

export async function rollbackReconstructionRelease(input: RollbackInput): Promise<ChannelEvent> {
  return api.post(
    `${FOUNDRY_BASE}/channels/production/rollback`,
    ReconstructionReleaseRollbackInputSchema.parse(input),
    false,
    ReconstructionReleaseChannelEventSchema,
  );
}

export function parseReconstructionReleaseChannelConflict(error: unknown): ChannelConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const candidate = error.details !== null && typeof error.details === "object" && !Array.isArray(error.details)
    ? { ...error.details, code: error.code }
    : { code: error.code };
  const parsed = ReconstructionReleaseChannelConflictSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export type {
  AttestationVerificationDraft,
  AttestationVerificationInput,
  AttestationMetadata,
  CandidateVerificationInput,
  ChannelEvent,
  ChannelConflict,
  ProductionChannel,
  PublicationInput,
  PublicationRecord,
  PromoteInput,
  ReleaseDetail,
  ReleaseList,
  ReleaseRegistration,
  ReviewInput,
  ReviewResult,
  RollbackInput,
  ReviewEvidenceArtifact,
  ReviewEvidenceArtifactList,
  ReviewEvidenceArtifactRegistrationInput,
  SigningPayload,
};
