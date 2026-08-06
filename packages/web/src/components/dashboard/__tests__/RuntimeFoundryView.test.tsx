import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  ReconstructionReleaseAttestationMetadata,
  ReconstructionReleaseChannel,
  ReconstructionReleaseChannelEvent,
  ReconstructionReleaseDetail,
  ReconstructionReleaseList,
  ReconstructionReleasePublication,
  ReconstructionReleaseRegistration,
  ReconstructionReleaseReview,
  ReconstructionReleaseSigningPayload,
} from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import type {
  AttestationVerificationDraft,
  CandidateVerificationInput,
} from "../../../api/reconstruction-foundry.js";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  listEvidence: vi.fn(),
  registerEvidence: vi.fn(),
  fetchEvidence: vi.fn(),
  get: vi.fn(),
  verifyCandidate: vi.fn<(input: CandidateVerificationInput) => Promise<ReconstructionReleaseRegistration>>(),
  review: vi.fn(),
  signingPayload: vi.fn(),
  verifyAttestation: vi.fn<(
    releaseId: string,
    input: AttestationVerificationDraft,
  ) => Promise<ReconstructionReleaseAttestationMetadata>>(),
  publish: vi.fn(),
  promote: vi.fn(),
  rollback: vi.fn(),
  parseConflict: vi.fn(),
}));

vi.mock("../../../api/reconstruction-foundry.js", () => ({
  listReconstructionReleases: mocks.list,
  listReconstructionReviewEvidenceArtifacts: mocks.listEvidence,
  registerReconstructionReviewEvidenceArtifact: mocks.registerEvidence,
  fetchReconstructionVisualEvidence: mocks.fetchEvidence,
  getReconstructionRelease: mocks.get,
  verifyReconstructionCandidate: mocks.verifyCandidate,
  reviewReconstructionRelease: mocks.review,
  getReconstructionReleaseSigningPayload: mocks.signingPayload,
  verifyReconstructionReleaseAttestation: mocks.verifyAttestation,
  publishReconstructionRelease: mocks.publish,
  promoteReconstructionRelease: mocks.promote,
  rollbackReconstructionRelease: mocks.rollback,
  parseReconstructionReleaseChannelConflict: mocks.parseConflict,
}));

import { RuntimeFoundryView } from "../RuntimeFoundryView.js";

const RELEASE_ID = "10000000-0000-4000-8000-000000000001";
const CURRENT_RELEASE_ID = "10000000-0000-4000-8000-000000000002";
const REVIEW_ID = "10000000-0000-4000-8000-000000000003";
const ATTESTATION_ID = "10000000-0000-4000-8000-000000000004";
const PUBLICATION_ID = "10000000-0000-4000-8000-000000000005";
const USER_ID = "10000000-0000-4000-8000-000000000006";
const EVENT_ID = "10000000-0000-4000-8000-000000000007";
const RELEASE_DIGEST = "a".repeat(64);
const CURRENT_DIGEST = "b".repeat(64);
const SOURCE_DIGEST = "c".repeat(64);
const QA_DIGEST = "d".repeat(64);
const REVIEW_DIGEST = "e".repeat(64);
const ENVELOPE_DIGEST = "f".repeat(64);
const ARTIFACT_DIGEST = "1".repeat(64);
const SCENE_DIGEST = "2".repeat(64);
const ISO_TIME = "2026-07-11T07:00:00.000Z";

const QA_KEYS = [
  "manifest_schema",
  "exact_file_set",
  "content_hashes",
  "image_dimensions",
  "mesh_structure",
  "mesh_budget",
  "navigation_graph",
  "coordinate_frame",
] as const;

const registration: ReconstructionReleaseRegistration = {
  id: RELEASE_ID,
  manifest: {
    schemaVersion: "venviewer.reconstruction-release.v1",
    releaseKind: "venue_twin_v1",
    venueSlug: "trades-hall",
    releaseDigest: RELEASE_DIGEST,
    sourceManifestSha256: SOURCE_DIGEST,
    files: [
      { path: "tiles/scan_000/equirect_512.webp", sha256: ARTIFACT_DIGEST, sizeBytes: 1_024, mimeType: "image/webp", role: "imagery" },
      { path: "manifest.json", sha256: SOURCE_DIGEST, sizeBytes: 512, mimeType: "application/json", role: "manifest" },
    ],
    fileCount: 2,
    totalBytes: 1_536,
    generatedAt: ISO_TIME,
  },
  candidateR2Prefix: `candidates/trades-hall/${RELEASE_DIGEST}`,
  candidateManifestR2Key: `candidates/trades-hall/${RELEASE_DIGEST}/release-manifest.json`,
  qaReport: {
    schemaVersion: "venviewer.reconstruction-qa.v1",
    releaseDigest: RELEASE_DIGEST,
    sourceManifestSha256: SOURCE_DIGEST,
    qaProfileVersion: "foundry-v1",
    qaProfileDigest: "3".repeat(64),
    outcome: "passed",
    checks: QA_KEYS.map((checkKey) => ({
      checkKey,
      status: "passed" as const,
      messageKey: `foundry.${checkKey}.passed`,
      evidence: [{ label: `${checkKey} evidence`, sha256: "4".repeat(64) }],
    })),
    reportDigest: QA_DIGEST,
  },
  idempotencyKey: "candidate:test-key",
  state: "awaiting_review",
  registeredBy: USER_ID,
  registeredAt: ISO_TIME,
};

const review: ReconstructionReleaseReview = {
  releaseId: RELEASE_ID,
  releaseDigest: RELEASE_DIGEST,
  qaReportDigest: QA_DIGEST,
  decision: "approved",
  targetExposure: "public",
  visualEvidence: [{ label: "tiles/scan_000/equirect_512.webp", objectKey: "tiles/scan_000/equirect_512.webp", sha256: ARTIFACT_DIGEST }],
  transformArtifactRef: { artifactId: "transform-v1", artifactDigest: ARTIFACT_DIGEST },
  sceneAuthorityMapRef: { artifactId: "scene-authority-v1", artifactDigest: SCENE_DIGEST },
  note: "Reviewed against the exact candidate evidence and authority records.",
  idempotencyKey: "review:test-key",
  id: REVIEW_ID,
  reviewerUserId: USER_ID,
  reviewerAuthority: "platform_admin",
  reviewedAt: ISO_TIME,
  reviewDigest: REVIEW_DIGEST,
};

const attestation: ReconstructionReleaseAttestationMetadata = {
  id: ATTESTATION_ID,
  releaseId: RELEASE_ID,
  releaseDigest: RELEASE_DIGEST,
  qaReportDigest: QA_DIGEST,
  reviewId: REVIEW_ID,
  reviewDigest: REVIEW_DIGEST,
  format: "dsse_in_toto_v1",
  algorithm: "ed25519",
  keyId: "foundry-production-key",
  publicKeyFingerprint: "5".repeat(64),
  statementSha256: "6".repeat(64),
  envelopeSha256: ENVELOPE_DIGEST,
  r2Key: `attestations/${RELEASE_DIGEST}.dsse.json`,
  verifiedAt: ISO_TIME,
  verifiedBy: USER_ID,
};

const publication: ReconstructionReleasePublication = {
  releaseId: RELEASE_ID,
  releaseDigest: RELEASE_DIGEST,
  qaReportDigest: QA_DIGEST,
  reviewId: REVIEW_ID,
  reviewDigest: REVIEW_DIGEST,
  attestationId: ATTESTATION_ID,
  attestationEnvelopeSha256: ENVELOPE_DIGEST,
  idempotencyKey: "publication:test-key",
  note: "Publish the reviewed and attested immutable release candidate.",
  id: PUBLICATION_ID,
  candidateR2Prefix: `candidates/trades-hall/${RELEASE_DIGEST}`,
  publicR2Prefix: `releases/sha256/${RELEASE_DIGEST.slice(0, 2)}/${RELEASE_DIGEST}`,
  publicManifestR2Key: `releases/sha256/${RELEASE_DIGEST.slice(0, 2)}/${RELEASE_DIGEST}/manifest.json`,
  publicManifestUrl: `https://assets.venviewer.test/releases/sha256/${RELEASE_DIGEST.slice(0, 2)}/${RELEASE_DIGEST}/manifest.json`,
  manifestSha256: SOURCE_DIGEST,
  fileCount: 2,
  totalBytes: 1_536,
  publishedBy: USER_ID,
  publishedAt: ISO_TIME,
  verifiedAt: ISO_TIME,
};

const channel: ReconstructionReleaseChannel = {
  venueSlug: "trades-hall",
  releaseKind: "venue_twin_v1",
  channel: "production",
  activeReleaseId: CURRENT_RELEASE_ID,
  activeReleaseDigest: CURRENT_DIGEST,
  activePublicationId: "10000000-0000-4000-8000-000000000008",
  revision: 4,
  updatedBy: USER_ID,
  updatedAt: ISO_TIME,
};

const promoteEvent: ReconstructionReleaseChannelEvent = {
  id: EVENT_ID,
  venueSlug: "trades-hall",
  releaseKind: "venue_twin_v1",
  channel: "production",
  action: "promote",
  fromReleaseId: CURRENT_RELEASE_ID,
  fromReleaseDigest: CURRENT_DIGEST,
  fromPublicationId: "10000000-0000-4000-8000-000000000008",
  toReleaseId: RELEASE_ID,
  toReleaseDigest: RELEASE_DIGEST,
  toPublicationId: PUBLICATION_ID,
  expectedRevision: 4,
  resultingRevision: 5,
  actorUserId: USER_ID,
  idempotencyKey: "promotion:test-key",
  reason: "Promote the fully reviewed release after final operator comparison.",
  createdAt: ISO_TIME,
};

function detail(overrides: Partial<ReconstructionReleaseDetail> = {}): ReconstructionReleaseDetail {
  return {
    registration,
    reviews: [review],
    attestations: [attestation],
    publication,
    productionChannel: channel,
    channelEvents: [],
    state: "published",
    ...overrides,
  };
}

function listFor(current: ReconstructionReleaseDetail): ReconstructionReleaseList {
  const latestReview = current.reviews[0] ?? null;
  return {
    releases: [{
      id: current.registration.id,
      venueSlug: current.registration.manifest.venueSlug,
      releaseKind: "venue_twin_v1",
      releaseDigest: current.registration.manifest.releaseDigest,
      sourceManifestSha256: current.registration.manifest.sourceManifestSha256,
      fileCount: current.registration.manifest.fileCount,
      totalBytes: current.registration.manifest.totalBytes,
      qaOutcome: current.registration.qaReport.outcome,
      qaReportDigest: current.registration.qaReport.reportDigest,
      latestReviewDecision: latestReview?.decision ?? null,
      latestReviewTargetExposure: latestReview?.targetExposure ?? null,
      attested: current.attestations.length > 0,
      published: current.publication !== null,
      active: current.productionChannel?.activeReleaseId === current.registration.id,
      state: current.state,
      registeredAt: current.registration.registeredAt,
    }],
    productionChannel: current.productionChannel,
  };
}

let currentDetail: ReconstructionReleaseDetail;

function mount(): void {
  render(
    <MemoryRouter initialEntries={[`/dashboard?view=foundry&venue=trades-hall&release=${RELEASE_ID}`]}>
      <RuntimeFoundryView />
    </MemoryRouter>,
  );
}

async function openAction(label: string, confirmLabel: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: label }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Operator reason"), {
    target: { value: "Operator reviewed the exact immutable evidence and approved this action." },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: confirmLabel }));
}

describe("RuntimeFoundryView", () => {
  beforeEach(() => {
    currentDetail = detail();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.list.mockImplementation(() => Promise.resolve(listFor(currentDetail)));
    mocks.listEvidence.mockResolvedValue({
      venueSlug: "trades-hall",
      artifacts: [
        {
          id: "10000000-0000-4000-8000-000000000008",
          venueSlug: "trades-hall",
          artifactKind: "transform_artifact_v0",
          artifactId: "transform-v1",
          artifactDigest: ARTIFACT_DIGEST,
          objectKey: `candidates/review-evidence/trades-hall/transform_artifact_v0/${ARTIFACT_DIGEST}.json`,
          objectSha256: ARTIFACT_DIGEST,
          sizeBytes: 1_024,
          schemaVersion: "venviewer.transform-artifact.v0",
          registeredBy: USER_ID,
          registeredAt: ISO_TIME,
        },
        {
          id: "10000000-0000-4000-8000-000000000009",
          venueSlug: "trades-hall",
          artifactKind: "scene_authority_map_v0",
          artifactId: "scene-authority-v1",
          artifactDigest: SCENE_DIGEST,
          objectKey: `candidates/review-evidence/trades-hall/scene_authority_map_v0/${SCENE_DIGEST}.json`,
          objectSha256: SCENE_DIGEST,
          sizeBytes: 2_048,
          schemaVersion: "venviewer.scene-authority-map.v0",
          registeredBy: USER_ID,
          registeredAt: ISO_TIME,
        },
      ],
    });
    mocks.fetchEvidence.mockResolvedValue(new Blob(["image"], { type: "image/webp" }));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:foundry-evidence") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    mocks.get.mockImplementation(() => Promise.resolve(currentDetail));
    mocks.verifyCandidate.mockResolvedValue(registration);
    mocks.review.mockResolvedValue(review);
    mocks.verifyAttestation.mockResolvedValue(attestation);
    mocks.publish.mockResolvedValue(publication);
    mocks.promote.mockResolvedValue(promoteEvent);
    mocks.rollback.mockResolvedValue({ ...promoteEvent, action: "rollback" });
    mocks.parseConflict.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a wired release ledger, current pointer, legacy registry link and candidate verifier", async () => {
    mount();

    expect(await screen.findByRole("heading", { name: "Runtime Foundry" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Release evidence" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open legacy room registry" }).getAttribute("href")).toBe("/dev/assets/rooms");
    expect(screen.getByText(CURRENT_DIGEST)).toBeTruthy();
    const reviewHeading = screen.getByRole("heading", { name: "Current human review binding" });
    const recordedReview = reviewHeading.closest("section");
    expect(recordedReview).not.toBeNull();
    if (recordedReview !== null) {
      const reviewPanel = within(recordedReview);
      expect(reviewPanel.getByText("platform admin")).toBeTruthy();
      expect(reviewPanel.getByText(USER_ID)).toBeTruthy();
      expect(reviewPanel.getByText(REVIEW_DIGEST)).toBeTruthy();
      expect(reviewPanel.getByText("transform-v1")).toBeTruthy();
      expect(reviewPanel.getByText("scene-authority-v1")).toBeTruthy();
      expect(reviewPanel.getByText(review.note)).toBeTruthy();
      expect(reviewPanel.getByRole("list", { name: "Visual evidence bound to current review" })).toBeTruthy();
    }

    const prefix = `candidates/trades-hall/${RELEASE_DIGEST}`;
    fireEvent.change(screen.getByLabelText("Private candidate R2 prefix"), { target: { value: prefix } });
    fireEvent.click(screen.getByRole("button", { name: "Verify candidate" }));

    await waitFor(() => {
      expect(mocks.verifyCandidate).toHaveBeenCalledTimes(1);
    });
    const candidateInput = mocks.verifyCandidate.mock.calls[0]?.[0];
    expect(candidateInput?.candidateR2Prefix).toBe(prefix);
    expect(candidateInput?.idempotencyKey).toMatch(/^foundry:/u);
  });

  it("does not reload the release ledger when only the selected detail tab changes", async () => {
    mount();

    await screen.findByRole("heading", { name: "Release evidence" });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "QA evidence" }));
    await screen.findByRole("tabpanel", { name: "QA evidence" });

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("requires exact visual, transform and scene-authority evidence before public approval", async () => {
    currentDetail = detail({ reviews: [], attestations: [], publication: null, productionChannel: null, state: "awaiting_review" });
    mount();

    fireEvent.click(await screen.findByRole("tab", { name: "QA evidence" }));
    const approve = await screen.findByRole("button", { name: "Approve public evidence" });
    expect(approve.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Open complete visual review board" }));
    const preview = await screen.findByRole("img", { name: "tiles/scan_000/equirect_512.webp" });
    fireEvent.load(preview);
    fireEvent.click(await screen.findByRole("button", { name: "Bind every displayed preview to this review" }));
    fireEvent.change(screen.getByLabelText("Verified TransformArtifact"), { target: { value: ARTIFACT_DIGEST } });
    fireEvent.change(screen.getByLabelText("Verified Scene Authority Map"), { target: { value: SCENE_DIGEST } });
    expect(approve.hasAttribute("disabled")).toBe(false);

    await openAction("Approve public evidence", "Record approval");
    await waitFor(() => {
      expect(mocks.review).toHaveBeenCalledWith(RELEASE_ID, expect.objectContaining({
        decision: "approved",
        targetExposure: "public",
        visualEvidence: [{ label: "tiles/scan_000/equirect_512.webp", objectKey: "tiles/scan_000/equirect_512.webp", sha256: ARTIFACT_DIGEST }],
        transformArtifactRef: { artifactId: "transform-v1", artifactDigest: ARTIFACT_DIGEST },
        sceneAuthorityMapRef: { artifactId: "scene-authority-v1", artifactDigest: SCENE_DIGEST },
      }));
    });
  });

  it("downloads the exact signing payload and validates parsed DSSE JSON before attestation verification", async () => {
    currentDetail = detail({ attestations: [], publication: null, state: "awaiting_attestation" });
    const payload = {
      schemaVersion: "venviewer.reconstruction-signing-payload.v1",
      payloadType: "application/vnd.in-toto+json",
      releaseId: RELEASE_ID,
      releaseDigest: RELEASE_DIGEST,
      qaReportDigest: QA_DIGEST,
      reviewId: REVIEW_ID,
      reviewDigest: REVIEW_DIGEST,
      statement: {
        _type: "https://in-toto.io/Statement/v1",
        subject: [{ name: `reconstruction-release/trades-hall/${RELEASE_DIGEST}`, digest: { sha256: RELEASE_DIGEST } }],
        predicateType: "https://venviewer.com/attestations/reconstruction-release/v1",
        predicate: {
          schemaVersion: "venviewer.reconstruction-attestation-predicate.v1",
          venueSlug: "trades-hall",
          releaseKind: "venue_twin_v1",
          releaseId: RELEASE_ID,
          releaseDigest: RELEASE_DIGEST,
          sourceManifestSha256: SOURCE_DIGEST,
          releaseManifestSha256: SOURCE_DIGEST,
          qaReportDigest: QA_DIGEST,
          reviewId: REVIEW_ID,
          reviewDigest: REVIEW_DIGEST,
          reviewedAt: ISO_TIME,
          reviewerUserId: USER_ID,
          decision: "approved",
          targetExposure: "public",
          visualEvidence: review.visualEvidence,
          transformArtifactRef: { artifactId: "transform-v1", artifactDigest: ARTIFACT_DIGEST },
          sceneAuthorityMapRef: { artifactId: "scene-authority-v1", artifactDigest: SCENE_DIGEST },
        },
      },
      payloadUtf8: "{}",
      payloadBase64: "e30=",
      payloadSha256: "7".repeat(64),
      payloadByteLength: 2,
    } satisfies ReconstructionReleaseSigningPayload;
    mocks.signingPayload.mockResolvedValue(payload);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:foundry") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Download signing payload" }));
    await waitFor(() => { expect(mocks.signingPayload).toHaveBeenCalledWith(RELEASE_ID, REVIEW_ID); });

    const envelope = { payloadType: "application/vnd.in-toto+json", payload: "e30=", signatures: [{ keyid: "foundry-production-key", sig: "YWJj" }] };
    fireEvent.change(screen.getByLabelText("Signed DSSE envelope JSON"), { target: { value: JSON.stringify(envelope) } });
    fireEvent.click(screen.getByRole("button", { name: "Verify signed envelope" }));
    await waitFor(() => {
      expect(mocks.verifyAttestation).toHaveBeenCalledTimes(1);
    });
    const attestationCall = mocks.verifyAttestation.mock.calls[0];
    expect(attestationCall?.[0]).toBe(RELEASE_ID);
    expect(attestationCall?.[1].reviewId).toBe(REVIEW_ID);
    expect(attestationCall?.[1].envelope).toEqual(envelope);
    expect(attestationCall?.[1].idempotencyKey).toMatch(/^foundry:/u);
  });

  it("publishes through the exact approved review and attestation bindings", async () => {
    currentDetail = detail({ publication: null, state: "ready_to_publish" });
    mount();

    await openAction("Publish immutable release", "Publish release");
    await waitFor(() => {
      expect(mocks.publish).toHaveBeenCalledWith(RELEASE_ID, expect.objectContaining({
        releaseId: RELEASE_ID,
        reviewId: REVIEW_ID,
        attestationId: ATTESTATION_ID,
        attestationEnvelopeSha256: ENVELOPE_DIGEST,
      }));
    });
  });

  it("reloads the production pointer and reports the current revision after a CAS conflict", async () => {
    const conflict = new ApiError(409, "Production pointer changed", "REVISION_CONFLICT", {
      currentRevision: 5,
      currentReleaseId: CURRENT_RELEASE_ID,
    });
    mocks.promote.mockRejectedValue(conflict);
    mocks.parseConflict.mockReturnValue({ code: "REVISION_CONFLICT", currentRevision: 5, currentReleaseId: CURRENT_RELEASE_ID });
    mount();

    await openAction("Promote to production", "Promote to production");
    expect(await screen.findByText(/Current revision is 5/u)).toBeTruthy();
    await waitFor(() => { expect(mocks.list.mock.calls.length).toBeGreaterThan(1); });
  });

  it("offers rollback only for a previously active published release and sends the current CAS identity", async () => {
    currentDetail = detail({ channelEvents: [promoteEvent] });
    mount();

    await openAction("Roll back to this release", "Roll back production");
    await waitFor(() => {
      expect(mocks.rollback).toHaveBeenCalledWith(expect.objectContaining({
        targetReleaseId: RELEASE_ID,
        targetPublicationId: PUBLICATION_ID,
        expectedRevision: 4,
        expectedActiveReleaseId: CURRENT_RELEASE_ID,
      }));
    });
  });
});
