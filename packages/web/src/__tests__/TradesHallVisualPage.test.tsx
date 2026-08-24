import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { EventPhaseGraph, EvidenceTargetType, RuntimePackage, TruthModeSummary } from "@omnitwin/types";

type OrbitControlsMockProps = Readonly<Record<string, unknown>>;
type CanvasMockProps = Readonly<{
  children?: React.ReactNode;
  frameloop?: unknown;
  dpr?: unknown;
  gl?: unknown;
  performance?: unknown;
}>;

const { getLatestRuntimePackageMock } = vi.hoisted(() => ({
  getLatestRuntimePackageMock: vi.fn(),
}));

const { getEventPhaseGraphMock } = vi.hoisted(() => ({
  getEventPhaseGraphMock: vi.fn(),
}));

const { getTruthModeSummaryMock } = vi.hoisted(() => ({
  getTruthModeSummaryMock: vi.fn(),
}));

const { getLatestGuestFlowReplayMock } = vi.hoisted(() => ({
  getLatestGuestFlowReplayMock: vi.fn(),
}));

const { orbitControlsMock } = vi.hoisted(() => ({
  orbitControlsMock: vi.fn<(props: OrbitControlsMockProps) => void>(),
}));

const {
  useLocalSogCandidateMock,
  useLocalGrandHallEvidenceMock,
  sparkSplatLayerMock,
} = vi.hoisted(() => ({
  useLocalSogCandidateMock: vi.fn(),
  useLocalGrandHallEvidenceMock: vi.fn(),
  sparkSplatLayerMock: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children, frameloop, dpr, gl, performance: perfOptions }: CanvasMockProps) => {
    const renderableChildren = React.Children.toArray(children).filter((child) => {
      if (!React.isValidElement(child)) return true;
      return typeof child.type !== "string" || child.type === "div";
    });
    const glRecord = typeof gl === "object" && gl !== null ? gl as Record<string, unknown> : {};
    const perfRecord = typeof perfOptions === "object" && perfOptions !== null
      ? perfOptions as Record<string, unknown>
      : {};
    const powerPreference = glRecord["powerPreference"];
    const antialias = glRecord["antialias"];
    const performanceMin = perfRecord["min"];
    const performanceDebounce = perfRecord["debounce"];
    return (
      <div
        data-testid="visual-canvas"
        data-frameloop={typeof frameloop === "string" ? frameloop : ""}
        data-dpr={JSON.stringify(dpr)}
        data-antialias={typeof antialias === "boolean" ? String(antialias) : ""}
        data-power-preference={typeof powerPreference === "string" ? powerPreference : ""}
        data-performance-min={typeof performanceMin === "number" ? String(performanceMin) : ""}
        data-performance-debounce={typeof performanceDebounce === "number" ? String(performanceDebounce) : ""}
      >
        {renderableChildren}
      </div>
    );
  },
  useFrame: vi.fn(),
  useThree: (selector?: (state: ReturnType<typeof makeR3fState>) => unknown) => {
    const state = makeR3fState();
    return selector === undefined ? state : selector(state);
  },
}));

function makeR3fState() {
  const position = {
    x: 0,
    y: 0,
    z: 0,
    set: vi.fn((x: number, y: number, z: number) => {
      position.x = x;
      position.y = y;
      position.z = z;
      return position;
    }),
    copy: vi.fn((source: { readonly x: number; readonly y: number; readonly z: number }) => {
      position.x = source.x;
      position.y = source.y;
      position.z = source.z;
      return position;
    }),
    lerpVectors: vi.fn((
      start: { readonly x: number; readonly y: number; readonly z: number },
      end: { readonly x: number; readonly y: number; readonly z: number },
      alpha: number,
    ) => {
      position.x = start.x + (end.x - start.x) * alpha;
      position.y = start.y + (end.y - start.y) * alpha;
      position.z = start.z + (end.z - start.z) * alpha;
      return position;
    }),
  };
  return {
    camera: {
      position,
      lookAt: vi.fn(),
      updateProjectionMatrix: vi.fn(),
    },
    invalidate: vi.fn(),
    performance: { current: 1 },
    viewport: { initialDpr: 2 },
    setDpr: vi.fn(),
  };
}

vi.mock("@react-three/drei", async () => {
  const ReactModule = await import("react");
  return {
    OrbitControls: ReactModule.forwardRef<unknown, OrbitControlsMockProps>(function MockOrbitControls(
      props,
      _ref,
    ) {
      orbitControlsMock(props);
      return null;
    }),
  };
});

vi.mock("../components/GrandHallRoom.js", () => ({
  GrandHallRoom: () => <div data-testid="grand-hall-room" />,
}));

vi.mock("../components/editor/RoomMesh.js", () => ({
  RoomMesh: ({ detail, variant }: { readonly detail?: string; readonly variant?: string }) => (
    <div data-testid="visual-room-mesh" data-detail={detail ?? ""} data-variant={variant ?? ""} />
  ),
}));

vi.mock("../components/scene/SparkSplatLayer.js", () => ({
  SparkSplatLayer: (props: Readonly<Record<string, unknown>> & { readonly url: string }) => {
    sparkSplatLayerMock(props);
    return <div data-testid="spark-splat-layer">{props.url}</div>;
  },
}));

vi.mock("../hooks/use-local-sog-candidate.js", () => ({
  useLocalSogCandidate: useLocalSogCandidateMock,
}));

vi.mock("../hooks/use-local-grand-hall-evidence.js", () => ({
  useLocalGrandHallEvidence: useLocalGrandHallEvidenceMock,
}));

vi.mock("../twin/TwinViewer.js", () => ({
  TwinViewer: ({ experience, evidenceDisclosure }: {
    readonly experience?: string;
    readonly evidenceDisclosure?: string;
  }) => (
    <section
      data-testid="local-evidence-twin-viewer"
      data-experience={experience ?? ""}
    >
      {evidenceDisclosure}
    </section>
  ),
}));

vi.mock("../api/runtime-packages.js", () => ({
  getLatestRuntimePackage: getLatestRuntimePackageMock,
}));

vi.mock("../api/events.js", () => ({
  getEventPhaseGraph: getEventPhaseGraphMock,
}));

vi.mock("../api/truth-mode.js", () => ({
  getTruthModeSummary: getTruthModeSummaryMock,
}));

vi.mock("../api/guest-flow-replay.js", () => ({
  getLatestGuestFlowReplay: getLatestGuestFlowReplayMock,
}));

vi.mock("../components/ai/AIDraftPanel.js", () => ({
  AIDraftPanel: ({ title }: { readonly title: string }) => (
    <section aria-label={title}>AI draft panel mocked for visual page tests.</section>
  ),
}));

import {
  TradesHallVisualPage,
  shouldUseLeanVisualMesh,
  shouldUseSmoothVisualControls,
  visualAdaptiveResolutionForViewportWidth,
  visualCanvasDprForViewportWidth,
  visualCanvasGlForViewportWidth,
  visualMouseButtonsForViewportWidth,
} from "../pages/TradesHallVisualPage.js";

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1440,
  });
  Object.defineProperty(navigator, "deviceMemory", {
    configurable: true,
    value: undefined,
  });
  getLatestRuntimePackageMock.mockResolvedValue(null);
  getEventPhaseGraphMock.mockResolvedValue(makePhaseGraph());
  getLatestGuestFlowReplayMock.mockRejectedValue(new Error("No stored replay in component test."));
  getTruthModeSummaryMock.mockImplementation(
    (input: { readonly targetType: EvidenceTargetType; readonly targetId: string }) =>
      Promise.resolve(makeTruthSummary(input.targetType, input.targetId)),
  );
  useLocalSogCandidateMock.mockReturnValue({
    status: "inactive",
    explicit: false,
    retry: vi.fn(),
  });
  useLocalGrandHallEvidenceMock.mockImplementation(
    (request: { readonly kind: string; readonly message?: string }) =>
      request.kind === "none"
        ? { status: "inactive", explicit: false, retry: vi.fn() }
        : request.kind === "invalid"
          ? {
              status: "error",
              explicit: true,
              message: request.message ?? "Invalid master evidence request.",
              retryable: false,
              retry: vi.fn(),
            }
          : { status: "loading", explicit: true, retry: vi.fn() },
  );
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  getLatestRuntimePackageMock.mockReset();
  getEventPhaseGraphMock.mockReset();
  getLatestGuestFlowReplayMock.mockReset();
  getTruthModeSummaryMock.mockReset();
  orbitControlsMock.mockReset();
  useLocalSogCandidateMock.mockReset();
  useLocalGrandHallEvidenceMock.mockReset();
  sparkSplatLayerMock.mockReset();
});

function mount(initialEntry = "/dev/trades-hall-visual"): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TradesHallVisualPage />
    </MemoryRouter>,
  );
}

const LOCAL_DESCRIPTOR_TOKEN = "t".repeat(43);
const LOCAL_DESCRIPTOR_URL =
  `http://127.0.0.1:55982/api/local-sog-candidate?token=${LOCAL_DESCRIPTOR_TOKEN}`;
const MASTER_EVIDENCE_DESCRIPTOR_URL =
  `http://127.0.0.1:55982/api/local-room-evidence-candidate?token=${LOCAL_DESCRIPTOR_TOKEN}`;

function makeLocalCandidateReadyState() {
  const memberInputs = [
    [
      "desktop-0",
      "lcc2-result/data/3dgs/0_1_0_1_0.sog",
      "sha256:4cdb89b8dad1cd6eaf560d4aa643e19c7398e3c449c7c8969b9487264f74275c",
    ],
    [
      "desktop-1",
      "lcc2-result/data/3dgs/0_3_0_1_0.sog",
      "sha256:ee8785d1639e23917e7755c127c5fa67b3c575ea26934a8282594ec0831e567b",
    ],
    [
      "desktop-2",
      "lcc2-result/data/3dgs/0_5_0_0_1.sog",
      "sha256:dab77f8d9c0e55d659cb293fbc35392058b6810564e9b839d0e594460794e751",
    ],
    [
      "desktop-3",
      "lcc2-result/data/3dgs/0_7_0_1_0.sog",
      "sha256:b51f3ac35985e464ae09bd9c169d224b08a3be5052919971cc0ccfb2c9178c04",
    ],
  ] as const;
  const candidateDigest =
    "sha256:1a2303e1d3c850d85e078edf966f3b10c9e06d7a8134403302a18e78f7a45b00";
  const members = memberInputs.map(([memberId, relativePath, sha256]) => ({
    memberId,
    relativePath,
    sha256,
    sizeBytes: 1,
    splatCount: 1,
    url: `http://127.0.0.1:55982/api/local-sog-candidate/members/${memberId}.sog?token=${LOCAL_DESCRIPTOR_TOKEN}`,
    identity: `${candidateDigest}:desktop:${memberId}:${sha256}`,
  }));
  return {
    status: "ready",
    explicit: true,
    retry: vi.fn(),
    candidate: {
      candidateId: "grand-hall-small-lcc2-8539a478-v1",
      candidateRevision: 1,
      candidateDigest,
      runtimeRegistration: "not_registered",
      labels: {
        title: "Grand Hall — captured visual candidate",
        source: "XGRIDS PortalCam · Grand Hall Small",
        status: "Owner-authorized Venviewer use · unreviewed visual only",
        caveat: "Appearance only; no placement, measurement, collision, operational export, or production activation authority. Publication rights are owner-authorized; this unregistered candidate remains technically QA-inactive.",
      },
      source: {
        manifestSha256: "sha256:f4ba054a560ec86fa75d623d10924ba6bf00c6790745137ec4a2c144a64da12d",
        frontierReceiptSha256: "sha256:fb6c12052b4029457c28e812b8d3290553415e5e69e9ae31cb08ad92d1a5d5f1",
        inventory: {
          sog: { count: 19 },
          meshPly: { count: 14 },
          bvh: { count: 14 },
          obj: { count: 1 },
          poses: { count: 2_894 },
        },
      },
      rights: {
        evidenceState: "operator_supplied_unverified",
        licensedUse: "authorized_for_all_venviewer_product_purposes",
        publicationAndDistributionRights: "owner_authorized",
        licensingBlocker: false,
        runtimeActivation: "technically_inactive_pending_alignment_qa_and_promotion",
      },
      authority: {
        appearance: "local_unreviewed_candidate",
        geometry: "none",
        placement: "none",
        measurement: "none",
        collision: "none",
        export: "none",
      },
      availableEvidence: { operationalAuthority: "none" },
      presentationTransform: {
        position: [0, 0, 0],
        rotation: [-Math.PI / 2, 0, 0],
        scale: 1,
      },
      presentationCamera: {
        position: [-8, 2, 8],
        target: [-8, 2, 0],
        fov: 65,
      },
    },
    selection: {
      tier: {
        id: "desktop",
        memberCount: 4,
        splatCount: 2_482_968,
        sizeBytes: 44_988_345,
      },
      members,
      selectionKey: `${candidateDigest}:desktop`,
    },
  };
}

function makeMasterEvidenceReadyState() {
  const referenceMember = (memberId: string, suffix: "jpg" | "png") => ({
    memberId,
    role: "captured_reference_image",
    mediaType: suffix === "png" ? "image/png" : "image/jpeg",
    suffix,
    sha256: `sha256:${"a".repeat(64)}`,
    sizeBytes: 1024,
    url: `http://127.0.0.1:55982/api/local-room-evidence-candidate/members/${memberId}.${suffix}?token=${LOCAL_DESCRIPTOR_TOKEN}`,
    authority: "none",
    alignment: "unregistered",
    provenance: "exact_test_reference",
    width: 1200,
    height: 800,
    classification: "captured_reference_image",
  });
  const capturedImages = [
    referenceMember("reference-grand-hall-room", "jpg"),
    referenceMember("reference-grand-hall-dark", "jpg"),
    referenceMember("reference-grand-hall-scaled", "jpg"),
    referenceMember("reference-grand-hall-facade", "jpg"),
    referenceMember("reference-grand-hall-floorplan", "png"),
  ];
  const pipelineReadySlots = [
    { id: "registered_metric_room_mesh", state: "not_produced", reason: "Registration pending." },
    { id: "e57_bounded_room_crop", state: "not_produced", reason: "Bounded derivative pending." },
    { id: "obj_normalized_room_glb", state: "not_produced", reason: "Transform pending." },
    { id: "movable_object_mask", state: "not_produced", reason: "Mask pending." },
  ];
  return {
    status: "ready",
    explicit: true,
    retry: vi.fn(),
    candidate: {
      candidateId: "grand-hall-owner-authorized-local-evidence-v1",
      candidateRevision: 1,
      candidateDigest: `sha256:${"b".repeat(64)}`,
      sources: [
        { sourceId: "grand-hall-small-lcc2", totalBytes: 182_313_418 },
        { sourceId: "trades-hall-twin-0", totalBytes: 576_580_078 },
        { sourceId: "raw-xgrids-portalcam", totalBytes: 5_637_931_654 },
        { sourceId: "matterport-e57-stage", totalBytes: 22_277_494_876 },
      ],
      presentations: {
        splat: {
          descriptorUrl: LOCAL_DESCRIPTOR_URL,
          tiers: [
            { id: "desktop", memberCount: 4, splatCount: 2_482_968 },
            { id: "mobile", memberCount: 3, splatCount: 1_240_774 },
          ],
        },
        panoramaWalk: {
          assetBaseUrl: `http://127.0.0.1:55982/api/local-room-evidence-candidate/twin/${LOCAL_DESCRIPTOR_TOKEN}`,
          presentationManifest: {
            nodes: Array.from({ length: 49 }, (_, index) => ({ id: `scan_${String(index).padStart(3, "0")}` })),
          },
        },
        meshReview: {
          members: Array.from({ length: 15 }, (_, index) => ({
            suffix: index === 14 ? "obj" : "ply",
          })),
        },
        capturedImages: { members: capturedImages },
        unclassifiedImages: {
          members: [{
            ...referenceMember("operator-grand-hall-reference-image", "jpg"),
            classification: "capture_lineage_unverified",
          }],
        },
        generatedImages: {
          members: [{
            ...referenceMember("operator-generated-grand-hall-reference", "png"),
            role: "generated_reference_image",
            classification: "generated_reference_image",
          }],
        },
        videoReference: {
          member: {
            memberId: "edited-trades-hall-reference-video",
            role: "edited_reference_video",
            mediaType: "video/quicktime",
            suffix: "mov",
            sha256: `sha256:${"c".repeat(64)}`,
            sizeBytes: 75_597_063,
            url: `http://127.0.0.1:55982/api/local-room-evidence-candidate/members/edited-trades-hall-reference-video.mov?token=${LOCAL_DESCRIPTOR_TOKEN}`,
            provenance: "operator_supplied_edited_reference_export",
          },
          provenanceClass: "edited_reference_video",
          lineage: "capture_or_generation_lineage_unverified",
          playback: "manual_only",
          preload: "metadata",
        },
        reports: { poseCount: 2_894 },
      },
      referenceOnly: [
        { id: "lcc2-btree-indexes", count: 14 },
        { id: "lcc2-sog-inventory", count: 19 },
        { id: "matterport-e57", sizeBytes: 20_518_437_888 },
        { id: "matterpak-obj", sizeBytes: 38_381_816 },
        { id: "historical-colmap-cubefaces", memberCount: 300 },
        {
          id: "brush-splat-ply-series",
          reason: "Discovered derivative series was not admitted because exact per-member identities were not supplied to this candidate and each file exceeds the bounded browser-member policy.",
        },
      ],
      pipelineReadySlots,
    },
  };
}

function latestSparkPropsByUrl(): readonly Record<string, unknown>[] {
  const propsByUrl = new Map<string, Record<string, unknown>>();
  for (const [candidate] of sparkSplatLayerMock.mock.calls) {
    const props = candidate as Record<string, unknown>;
    const url = props["url"];
    if (typeof url === "string") propsByUrl.set(url, props);
  }
  return [...propsByUrl.values()];
}

function isSparkEventCallback(value: unknown): value is (event: Record<string, unknown>) => void {
  return typeof value === "function";
}

function makeTruthSummary(targetType: EvidenceTargetType, targetId: string): TruthModeSummary {
  const source = targetType === "route"
    ? "Route-clearance evidence is not checked in this evidence summary."
    : `${targetType} evidence summary loaded from Truth Mode data.`;
  return {
    targetType,
    targetId,
    source,
    confidence: targetType === "room" ? "medium" : "low",
    assumption: targetType === "route"
      ? "Route-clearance evidence is not checked; human review is required."
      : "One active planning assumption is linked.",
    evidenceStatus: targetType === "runtime_asset" ? "partial" : "not_checked",
    reviewGate: targetType === "review_gate" ? "One open review gate." : "Human review required.",
    staleState: targetType === "room" ? "current" : "review_due",
    safeWording: ["Planning evidence", "Human review required"],
    humanReviewRequired: true,
    counts: {
      evidenceItems: 1,
      checkResults: 1,
      assumptions: 1,
      reviewGates: 1,
      staleEvents: targetType === "room" ? 0 : 1,
    },
  };
}

function makeRuntimePackage(roomSlug = "robert-adam-room"): RuntimePackage {
  const assetVersionId = "10000000-0000-4000-8000-000000000001";
  return {
    id: "rp1",
    venueSlug: "trades-hall",
    roomSlug,
    primaryVisualAssetVersionId: assetVersionId,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug,
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: assetVersionId,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "unverified",
    runtimeStatus: "published",
    createdAt: "2026-06-06T10:00:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
    primaryVisualAssetUrl: `https://assets.example/${roomSlug}/scene.ply`,
    visualAssetUrls: [`https://assets.example/${roomSlug}/scene.ply`],
    primaryVisualAssetVersion: {
      id: assetVersionId,
      venueSlug: "trades-hall",
      roomSlug,
      captureSessionId: null,
      assetKind: "splat",
      sourceType: roomSlug === "grand-hall" ? "runpod" : "xgrids",
      r2Key: `venues/trades-hall/rooms/${roomSlug}/scene.ply`,
      fileName: "scene.ply",
      fileExt: ".ply",
      externalUrl: null,
      mimeType: "application/octet-stream",
      sha256: "a".repeat(64),
      sizeBytes: 2048,
      evidenceStatus: "unverified",
      runtimeStatus: "usable",
      notes: null,
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
    },
  };
}

function makePhaseGraph(): EventPhaseGraph {
  const eventId = "00000000-0000-4000-8000-000000000001";
  const venueId = "00000000-0000-4000-8000-000000000002";
  const phaseId = "00000000-0000-4000-8000-000000000003";
  const variantId = "00000000-0000-4000-8000-000000000004";
  const configId = "00000000-0000-4000-8000-000000000005";
  const linkId = "00000000-0000-4000-8000-000000000006";
  const now = "2026-06-11T10:00:00.000Z";
  return {
    event: {
      id: eventId,
      venueId,
      createdBy: "00000000-0000-4000-8000-000000000099",
      name: "Smith wedding",
      eventType: "wedding",
      status: "in_planning",
      startsAt: now,
      endsAt: null,
      guestCount: 120,
      clientName: "Smith family",
      notes: null,
      createdAt: now,
      updatedAt: now,
    },
    phases: [{
      id: phaseId,
      eventId,
      spaceId: null,
      templateKey: "dinner",
      name: "Dinner service",
      sortOrder: 0,
      startsAt: "2026-06-11T18:00:00.000Z",
      durationMinutes: 90,
      guestCount: 120,
      opsTasksCount: 7,
      reviewGatesCount: 2,
      densityStatus: "not_checked",
      densityLabel: "Density not checked",
      staffConflictsStatus: "not_checked",
      staffConflictsLabel: "Staff conflicts not checked",
      notes: null,
      createdAt: now,
      updatedAt: now,
    }],
    scenarios: [],
    layoutVariants: [{
      id: variantId,
      eventId,
      configurationId: configId,
      name: "Dinner option A",
      status: "draft",
      guestCount: 120,
      notes: null,
      createdAt: now,
      updatedAt: now,
    }],
    configurationLinks: [{
      id: linkId,
      eventId,
      configurationId: configId,
      layoutVariantId: variantId,
      linkType: "variant_configuration",
      createdAt: now,
    }],
    phaseLayoutSnapshots: [],
  };
}

describe("TradesHallVisualPage", () => {
  it("uses the lean visual scene and capped DPR for mobile and tablet viewports", () => {
    expect(visualCanvasDprForViewportWidth(390)).toEqual([1, 1]);
    expect(visualCanvasDprForViewportWidth(768)).toEqual([0.75, 0.75]);
    expect(visualCanvasDprForViewportWidth(1024)).toEqual([0.75, 0.75]);
    expect(visualCanvasDprForViewportWidth(1440)).toEqual([1, 1]);
    expect(visualCanvasGlForViewportWidth(390)).toEqual({
      antialias: false,
      powerPreference: "high-performance",
    });
    expect(visualCanvasGlForViewportWidth(768)).toEqual({
      antialias: false,
      powerPreference: "high-performance",
    });
    expect(visualCanvasGlForViewportWidth(1024)).toEqual({
      antialias: false,
      powerPreference: "high-performance",
    });
    expect(visualCanvasGlForViewportWidth(1440)).toEqual({
      antialias: true,
      powerPreference: "high-performance",
    });
    expect(shouldUseSmoothVisualControls(390)).toBe(false);
    expect(shouldUseSmoothVisualControls(768)).toBe(false);
    expect(shouldUseSmoothVisualControls(1024)).toBe(false);
    expect(shouldUseSmoothVisualControls(1440)).toBe(true);
    expect(visualMouseButtonsForViewportWidth(768)).toEqual({ LEFT: -1, MIDDLE: -1, RIGHT: -1 });
    expect(visualMouseButtonsForViewportWidth(1440)).toBeUndefined();
    expect(shouldUseLeanVisualMesh(768)).toBe(true);
    expect(shouldUseLeanVisualMesh(1440)).toBe(false);
    expect(visualAdaptiveResolutionForViewportWidth(390)).toEqual({
      enabled: false,
      minDpr: 1,
      maxDpr: 1,
    });
    expect(visualAdaptiveResolutionForViewportWidth(768)).toEqual({
      enabled: false,
      minDpr: 0.75,
      maxDpr: 0.75,
    });
    expect(visualAdaptiveResolutionForViewportWidth(1440)).toEqual({
      enabled: false,
      minDpr: 1,
      maxDpr: 1,
    });
  });

  it("demand-renders the runtime canvas with capped DPR and high-performance GPU preference", () => {
    mount();
    const canvas = screen.getByTestId("visual-canvas");
    expect(canvas.getAttribute("data-frameloop")).toBe("demand");
    expect(canvas.getAttribute("data-dpr")).toBe("[1,1]");
    expect(canvas.getAttribute("data-antialias")).toBe("true");
    expect(canvas.getAttribute("data-power-preference")).toBe("high-performance");
    expect(canvas.getAttribute("data-performance-min")).toBe("0.25");
    expect(canvas.getAttribute("data-performance-debounce")).toBe("180");
    expect(orbitControlsMock).toHaveBeenCalledWith(expect.objectContaining({
      enableDamping: false,
      mouseButtons: { LEFT: -1, MIDDLE: -1, RIGHT: -1 },
    }));
  });

  it("renders the internal command shell empty state without mounting a Spark asset", () => {
    mount();
    expect(screen.getByText("Venviewer")).toBeTruthy();
    expect(screen.getByText("Truth Mode")).toBeTruthy();
    expect(screen.getByText("Event Phase Graph")).toBeTruthy();
    expect(screen.getByText("Guest Flow Replay")).toBeTruthy();
    expect(screen.getAllByText("Overlays").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Expand Overlay controls" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand Overlay controls" }));
    expect(screen.getByRole("button", { name: "Expand View status" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand View status" }));
    expect(screen.getByLabelText("Visual view status")).toBeTruthy();
    expect(screen.getByLabelText("Current visual view: 3D")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "3D view" })).toBeNull();
    expect(screen.queryByRole("button", { name: "2D view" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Current mode/i })).toBeNull();
    expect(screen.getByText(/Simulated guest flow .* planning evidence/i)).toBeTruthy();
    expect(screen.getByText("Simulated guest flow - planning support")).toBeTruthy();
    expect(screen.getByText(/Bottleneck score/i)).toBeTruthy();
    expect(screen.getByLabelText("Replay controls")).toBeTruthy();
    expect(screen.getByLabelText("Replay progress")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(screen.getByText(/Human review required before operational reliance/i)).toBeTruthy();
    expect(screen.getByText("Internal command shell demo")).toBeTruthy();
    expect(screen.getByText("Internal demo phase fixture")).toBeTruthy();
    expect(screen.getAllByText(/Density not checked/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Staff conflicts not checked/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("No real asset loaded yet").length).toBeGreaterThan(0);
    expect(screen.getByTestId("visual-room-mesh").getAttribute("data-detail")).toBe("detailed");
    expect(screen.getByTestId("visual-room-mesh").getAttribute("data-variant")).toBe("grand-hall-synthetic");
    expect(screen.getByTestId("visual-synthetic-stand-in-label").textContent)
      .toContain("Synthetic Grand Hall stand-in · not a measured capture");
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
  });

  it("requests the Grand Hall runtime package by default", async () => {
    mount();
    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "grand-hall",
      });
    });
  });

  it("loads Truth Mode summary for the selected table by default", async () => {
    mount();
    await waitFor(() => {
      expect(getTruthModeSummaryMock).toHaveBeenCalledWith({
        targetType: "table",
        targetId: "table-12",
      });
      expect(screen.getByText("table evidence summary loaded from Truth Mode data.")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Selected table" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Selected route" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Selected room" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Runtime asset" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review gate" })).toBeTruthy();
  });

  it("switches Truth Mode selection to route evidence", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Selected route" }));
    await waitFor(() => {
      expect(getTruthModeSummaryMock).toHaveBeenCalledWith({
        targetType: "route",
        targetId: "dinner:route-clearance",
      });
      expect(screen.getAllByText(/Route-clearance evidence is not checked/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: "Selected route" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("requests the Robert Adam Room package from query params", async () => {
    mount("/dev/trades-hall-visual?venue=trades-hall&room=robert-adam-room");
    expect(screen.getAllByText(/Robert Adam Room/i).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "robert-adam-room",
      });
    });
  });

  it("requests the Saloon package from query params", async () => {
    mount("/dev/trades-hall-visual?venue=trades-hall&room=saloon");
    expect(screen.getAllByText(/Saloon/i).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "saloon",
      });
    });
  });

  it("requests the Reception Room package from query params", async () => {
    mount("/dev/trades-hall-visual?venue=trades-hall&room=reception-room");
    expect(screen.getAllByText(/Reception Room/i).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "reception-room",
      });
    });
  });

  it("requests the Lady Convenor's Room package from query params", async () => {
    mount("/dev/trades-hall-visual?venue=trades-hall&room=lady-convenors-room");
    expect(screen.getAllByText(/Lady Convenor's Room/i).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "lady-convenors-room",
      });
    });
  });

  it("requests the North Gallery package from query params", async () => {
    mount("/dev/trades-hall-visual?venue=trades-hall&room=north-gallery");
    expect(screen.getAllByText(/North Gallery/i).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "north-gallery",
      });
    });
  });

  it("requests the South Gallery package from query params", async () => {
    mount("/dev/trades-hall-visual?venue=trades-hall&room=south-gallery");
    expect(screen.getAllByText(/South Gallery/i).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "south-gallery",
      });
    });
  });

  it("mounts a registry runtime package only after the API returns one", async () => {
    getLatestRuntimePackageMock.mockResolvedValue(makeRuntimePackage("robert-adam-room"));
    render(
      <MemoryRouter initialEntries={["/dev/trades-hall-visual?venue=trades-hall&room=robert-adam-room"]}>
        <TradesHallVisualPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("spark-splat-layer").textContent).toBe(
        "https://assets.example/robert-adam-room/scene.ply",
      );
    });
  });

  it("does not mount the procedural Grand Hall room when a registered runtime package is active", async () => {
    getLatestRuntimePackageMock.mockResolvedValue(makeRuntimePackage("reception-room"));
    render(
      <MemoryRouter initialEntries={["/dev/trades-hall-visual?venue=trades-hall&room=reception-room"]}>
        <TradesHallVisualPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("spark-splat-layer").textContent).toBe(
        "https://assets.example/reception-room/scene.ply",
      );
    });
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();
    expect(orbitControlsMock).toHaveBeenCalledWith(expect.objectContaining({
      enableDamping: true,
      dampingFactor: 0.14,
      target: [0, 0.9, -4.15],
      minDistance: 1.2,
      maxDistance: 13.5,
      panSpeed: 0.16,
      rotateSpeed: 0.36,
      zoomSpeed: 0.32,
      minPolarAngle: Math.PI * 0.14,
      maxPolarAngle: Math.PI * 0.48,
    }));
    const runtimeControlsProps = orbitControlsMock.mock.calls
      .map(([props]) => props)
      .find((props) => Array.isArray(props["target"]) && props["target"][2] === -4.15);
    expect(runtimeControlsProps?.["onStart"]).toEqual(expect.any(Function));
  });

  it("renders the explicit local Grand Hall candidate as an appearance-only splat and keeps hybrid opt-in", async () => {
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 8 });
    getLatestRuntimePackageMock.mockResolvedValue(makeRuntimePackage("grand-hall"));
    useLocalSogCandidateMock.mockReturnValue(makeLocalCandidateReadyState());

    mount(`/dev/trades-hall-visual?localSogCandidate=${encodeURIComponent(LOCAL_DESCRIPTOR_URL)}`);

    await waitFor(() => {
      expect(screen.getAllByTestId("spark-splat-layer")).toHaveLength(4);
    });
    expect(screen.getByTestId("local-sog-candidate-panel")).toBeTruthy();
    expect(screen.getByText("Use rights · owner authorized")).toBeTruthy();
    expect(screen.getByText("Appearance-only review")).toBeTruthy();
    expect(screen.getByText("Operational scene authority · unregistered")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show candidate details" }).getAttribute("aria-expanded"))
      .toBe("false");
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.queryByTestId("visual-synthetic-stand-in-label")).toBeNull();
    expect(screen.queryByText("https://assets.example/grand-hall/scene.ply")).toBeNull();
    expect(useLocalSogCandidateMock).toHaveBeenCalledWith(
      { kind: "ready", descriptorUrl: LOCAL_DESCRIPTOR_URL },
      1440,
      4_000_000,
    );

    const splatProps = latestSparkPropsByUrl();
    expect(splatProps).toHaveLength(4);
    expect(splatProps.every((props) => props["position"]?.toString() === "0,0,0")).toBe(true);
    expect(splatProps.every((props) => props["rotation"]?.toString() === `${String(-Math.PI / 2)},0,0`)).toBe(true);
    expect(splatProps.every((props) => props["onLoad"] === splatProps[0]?.["onLoad"])).toBe(true);
    expect(splatProps.every((props) => props["onError"] === splatProps[0]?.["onError"])).toBe(true);
    expect(orbitControlsMock).toHaveBeenCalledWith(expect.objectContaining({
      target: [-8, 2, 0],
      minDistance: 1.2,
      maxDistance: 24,
    }));

    fireEvent.click(screen.getByRole("button", { name: /Hybrid/i }));
    expect(screen.getByTestId("visual-room-mesh").getAttribute("data-detail")).toBe("lean");
    expect(screen.getByTestId("local-sog-candidate-panel")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show candidate details" }));
    expect(screen.getByRole("button", { name: "Hide details" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Splat/i }));
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.getByTestId("local-sog-candidate-panel")).toBeTruthy();
  });

  it("keeps a local member failure sticky when another member subsequently loads", async () => {
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 8 });
    useLocalSogCandidateMock.mockReturnValue(makeLocalCandidateReadyState());
    mount(`/dev/trades-hall-visual?localSogCandidate=${encodeURIComponent(LOCAL_DESCRIPTOR_URL)}`);
    await waitFor(() => { expect(screen.getAllByTestId("spark-splat-layer")).toHaveLength(4); });

    const splatProps = latestSparkPropsByUrl();
    const firstProps = splatProps[0];
    const secondProps = splatProps[1];
    const onError = firstProps?.["onError"];
    const onLoad = secondProps?.["onLoad"];
    if (!isSparkEventCallback(onError) || !isSparkEventCallback(onLoad)) {
      throw new Error("Local Spark callbacks were not mounted.");
    }
    act(() => {
      onError({ url: firstProps?.["url"], error: new Error(`failed ${LOCAL_DESCRIPTOR_URL}`) });
      onLoad({ url: secondProps?.["url"], splatCount: 649_182, localBounds: null });
    });

    expect(screen.getAllByText(/A local SOG member could not be rendered/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/SOG rendering failed:/i)).toBeTruthy();
    expect(screen.getByText(/SOG rendering failed:/i).textContent).not.toContain("token=");
  });

  it("suppresses a registered package when an explicit local candidate request fails", async () => {
    getLatestRuntimePackageMock.mockResolvedValue(makeRuntimePackage("grand-hall"));
    useLocalSogCandidateMock.mockReturnValue({
      status: "error",
      explicit: true,
      message: "The local candidate gateway returned HTTP 503.",
      retryable: true,
      retry: vi.fn(),
    });

    mount(`/dev/trades-hall-visual?localSogCandidate=${encodeURIComponent(LOCAL_DESCRIPTOR_URL)}`);

    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({ venue: "trades-hall", room: "grand-hall" });
    });
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("HTTP 503");
    expect(screen.getByText(/Operational scene authority · unregistered/i)).toBeTruthy();
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
  });

  it("keeps the all-source master grant exclusive and suppresses registered fallback while verifying", async () => {
    getLatestRuntimePackageMock.mockResolvedValue(makeRuntimePackage("grand-hall"));

    mount(
      `/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&localRoomEvidence=${encodeURIComponent(MASTER_EVIDENCE_DESCRIPTOR_URL)}`,
    );

    await waitFor(() => {
      expect(useLocalGrandHallEvidenceMock).toHaveBeenCalledWith({
        kind: "ready",
        descriptorUrl: MASTER_EVIDENCE_DESCRIPTOR_URL,
      });
    });
    expect(useLocalSogCandidateMock).toHaveBeenCalledWith(
      { kind: "none" },
      1440,
      1_500_000,
    );
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.getByText("Grand Hall master evidence view")).toBeTruthy();
    expect(screen.getByText(/verifying sealed owner attestation/i)).toBeTruthy();
    expect(screen.queryByText(/owner authorized/i)).toBeNull();
  });

  it("switches one heavy master-evidence stage at a time and rejects stale SOG callbacks on round trip", async () => {
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 8 });
    useLocalGrandHallEvidenceMock.mockReturnValue(makeMasterEvidenceReadyState());
    const localSogState = makeLocalCandidateReadyState();
    useLocalSogCandidateMock.mockReturnValue(localSogState);

    mount(
      `/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&localRoomEvidence=${encodeURIComponent(MASTER_EVIDENCE_DESCRIPTOR_URL)}`,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("spark-splat-layer")).toHaveLength(4);
    });
    expect(screen.getAllByTestId("visual-canvas")).toHaveLength(1);
    expect(screen.queryByRole("navigation", { name: "Visual command modes" })).toBeNull();
    expect(screen.queryByLabelText("Venue spatial overlays")).toBeNull();
    expect(screen.queryByLabelText("Venue overlay legend")).toBeNull();
    expect(screen.queryByLabelText("Truth Mode and visual evidence panel")).toBeNull();
    expect(screen.queryByLabelText("Event Phase Graph")).toBeNull();
    expect(screen.queryByLabelText("Visual insight cards")).toBeNull();
    expect(screen.queryByText("Internal draft saved")).toBeNull();
    expect(screen.getByText("Ephemeral local review")).toBeTruthy();
    expect(screen.getByText("Grand Hall / Evidence review")).toBeTruthy();
    expect(screen.getByText(/desktop selected · 4 exact members · 2,482,968 declared splats/i))
      .toBeTruthy();
    expect(document.body.textContent).not.toContain("splats rendered");
    const oldSpatialProps = latestSparkPropsByUrl();
    const oldOnLoad = oldSpatialProps[0]?.["onLoad"];
    if (!isSparkEventCallback(oldOnLoad)) {
      throw new Error("The first spatial generation did not expose an onLoad callback.");
    }

    fireEvent.click(screen.getByRole("button", { name: /Walk \+ mesh/i }));
    await waitFor(() => {
      expect(screen.getByTestId("local-evidence-twin-viewer")).toBeTruthy();
    });
    expect(screen.queryByTestId("visual-canvas")).toBeNull();
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
    expect(screen.getByTestId("local-evidence-twin-viewer").getAttribute("data-experience"))
      .toBe("local-evidence-review");
    expect(screen.getAllByText(/Walk \+ mesh selected/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Reference media/i }));
    expect(screen.queryByTestId("local-evidence-twin-viewer")).toBeNull();
    expect(screen.queryByTestId("visual-canvas")).toBeNull();
    expect(screen.getByTestId("grand-hall-reference-media")).toBeTruthy();
    expect((document.querySelector("img") as HTMLImageElement).crossOrigin).toBe("anonymous");
    expect(screen.getAllByText(/Reference media selected/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Spatial capture/i }));
    await waitFor(() => {
      expect(screen.getAllByTestId("spark-splat-layer")).toHaveLength(4);
    });
    expect(screen.getAllByTestId("visual-canvas")).toHaveLength(1);
    expect(screen.queryByText(/1\/4/)).toBeNull();

    act(() => {
      oldOnLoad({
        url: oldSpatialProps[0]?.["url"],
        splatCount: 643_263,
        localBounds: null,
      });
    });
    expect(screen.queryByText(/1\/4/)).toBeNull();

    const currentSpatialProps = latestSparkPropsByUrl();
    const currentOnLoad = currentSpatialProps[0]?.["onLoad"];
    if (!isSparkEventCallback(currentOnLoad)) {
      throw new Error("The remounted spatial generation did not expose an onLoad callback.");
    }
    act(() => {
      currentOnLoad({
        url: currentSpatialProps[0]?.["url"],
        splatCount: 643_263,
        localBounds: null,
      });
    });
    await waitFor(() => {
      expect(screen.getAllByText(/\(1\/4\)/).length).toBeGreaterThan(0);
    });

    const currentOnError = currentSpatialProps[0]?.["onError"];
    if (!isSparkEventCallback(currentOnError)) {
      throw new Error("The remounted spatial generation did not expose an onError callback.");
    }
    act(() => {
      currentOnError({
        url: currentSpatialProps[0]?.["url"],
        error: new Error(`failed ${MASTER_EVIDENCE_DESCRIPTOR_URL}`),
      });
    });
    const spatialAlert = screen.getByRole("alert");
    expect(spatialAlert.textContent).toContain("Spatial capture render failed");
    expect(spatialAlert.textContent).not.toContain("token=");
    expect(screen.getAllByText(/A local SOG member could not be rendered/i).length)
      .toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Retry spatial evidence" }));
    expect(localSogState.retry).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/Reloading the exact spatial-capture grant/i).length)
      .toBeGreaterThan(0);
  });

  it("keeps decoded SOG evidence across a resize that retains the same exact tier", async () => {
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 8 });
    useLocalGrandHallEvidenceMock.mockReturnValue(makeMasterEvidenceReadyState());
    let previousWidth: number | null = null;
    let localSogState = makeLocalCandidateReadyState();
    useLocalSogCandidateMock.mockImplementation((_request, viewportWidth: number) => {
      if (viewportWidth !== previousWidth) {
        previousWidth = viewportWidth;
        localSogState = makeLocalCandidateReadyState();
      }
      return localSogState;
    });

    mount(
      `/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&localRoomEvidence=${encodeURIComponent(MASTER_EVIDENCE_DESCRIPTOR_URL)}`,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId("spark-splat-layer")).toHaveLength(4);
    });

    const members = latestSparkPropsByUrl();
    act(() => {
      for (const member of members) {
        const onLoad = member["onLoad"];
        if (!isSparkEventCallback(onLoad)) {
          throw new Error("The spatial member did not expose an onLoad callback.");
        }
        onLoad({
          url: member["url"],
          splatCount: 1,
          localBounds: null,
        });
      }
    });
    await waitFor(() => {
      expect(screen.getByText(/4\/4 selected members/i)).toBeTruthy();
    });

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1360,
    });
    act(() => { window.dispatchEvent(new Event("resize")); });

    await waitFor(() => {
      expect(useLocalSogCandidateMock).toHaveBeenCalledWith(
        expect.any(Object),
        1360,
        4_000_000,
      );
    });
    expect(screen.getByText(/4\/4 selected members/i)).toBeTruthy();
    expect(screen.queryByText(/0\/4 selected members/i)).toBeNull();
  });

  it("fails closed when the exact Grand Hall grant is requested under another safe venue slug", async () => {
    getLatestRuntimePackageMock.mockResolvedValue(makeRuntimePackage("grand-hall"));
    mount(
      `/dev/trades-hall-visual?venue=some-other-venue&room=grand-hall&localRoomEvidence=${encodeURIComponent(MASTER_EVIDENCE_DESCRIPTOR_URL)}`,
    );

    await waitFor(() => {
      expect(useLocalGrandHallEvidenceMock).toHaveBeenCalledWith(expect.objectContaining({
        kind: "invalid",
      }));
    });
    expect(useLocalSogCandidateMock).toHaveBeenCalledWith(
      { kind: "none" },
      1440,
      1_500_000,
    );
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/Trades Hall \/ Grand Hall/i);
  });

  it("fails closed when master and legacy local grants are both supplied", async () => {
    mount(
      `/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&localRoomEvidence=${encodeURIComponent(MASTER_EVIDENCE_DESCRIPTOR_URL)}&localSogCandidate=${encodeURIComponent(LOCAL_DESCRIPTOR_URL)}`,
    );

    await waitFor(() => {
      expect(useLocalGrandHallEvidenceMock).toHaveBeenCalledWith(expect.objectContaining({
        kind: "invalid",
      }));
    });
    expect(useLocalSogCandidateMock).toHaveBeenCalledWith(
      { kind: "none" },
      1440,
      1_500_000,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/not both/i);
  });

  it("ignores manual splatUrl query params and keeps the procedural fallback", () => {
    mount("/dev/trades-hall-visual?splatUrl=https%3A%2F%2Fassets.venviewer.test%2Fscene.ply");
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
    expect(screen.getByTestId("visual-room-mesh").getAttribute("data-detail")).toBe("detailed");
    expect(screen.getAllByText("No real asset loaded yet").length).toBeGreaterThan(0);
    expect(screen.getByText(/Manual runtime URLs are disabled/i)).toBeTruthy();
  });

  it("does not present production or verification claims", () => {
    mount();
    const bodyText = document.body.textContent;
    expect(bodyText).not.toMatch(/Black Label/i);
    expect(bodyText).not.toMatch(/production ready/i);
    expect(bodyText).not.toMatch(/real Trades Hall loaded/i);
    expect(bodyText).not.toMatch(/photoreal/i);
    expect(bodyText).not.toMatch(/survey-grade/i);
    expect(bodyText).not.toMatch(/legally compliant/i);
    expect(bodyText).not.toMatch(/fire approved/i);
    expect(bodyText).not.toMatch(/certified safe/i);
    expect(bodyText).not.toMatch(/approved for occupancy/i);
    expect(bodyText).not.toMatch(/guaranteed accessible/i);
  });

  it("renders worker/fallback replay status and lets operators scrub playback", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Expand Overlay controls" }));
    await waitFor(() => {
      expect(screen.getAllByText(/Deterministic fallback replay|Worker replay generated/i).length).toBeGreaterThan(0);
    });

    const slider = screen.getByLabelText("Replay progress");
    expect(slider).toBeInstanceOf(HTMLInputElement);
    if (!(slider instanceof HTMLInputElement)) {
      throw new Error("Replay progress control must be an input.");
    }
    fireEvent.change(slider, { target: { value: "15" } });
    expect(slider.value).toBe("15");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("switches mesh, splat, and hybrid layer state", () => {
    mount();
    expect(screen.getByRole("button", { name: /Hybrid/i }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Splat/i }));
    expect(screen.getByRole("button", { name: /Splat/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Mesh/i }));
    expect(screen.getByRole("button", { name: /Mesh/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("visual-room-mesh").getAttribute("data-detail")).toBe("detailed");
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();
  });

  it("keeps the synthetic hall shell lean on tablet viewports", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 768,
    });

    mount();

    expect(screen.getByTestId("visual-room-mesh").getAttribute("data-detail")).toBe("lean");
    expect(screen.getByTestId("visual-room-mesh").getAttribute("data-variant")).toBe("grand-hall-synthetic");
    expect(screen.getByTestId("visual-synthetic-stand-in-label")).toBeTruthy();
  });

  it("lets operators minimize floating controls and callouts", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/dev/trades-hall-visual"]}>
        <TradesHallVisualPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Expand Overlay controls" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Minimize Visual layer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand View status" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Minimize Route clearance" }).length).toBe(2);

    const overlayWidget = container.querySelector<HTMLElement>("[data-floating-widget-id='visual-overlay-legend']");
    if (overlayWidget === null) throw new Error("Overlay widget shell was not rendered.");
    expect(overlayWidget.getAttribute("data-minimized")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Expand Overlay controls" }));
    expect(overlayWidget.getAttribute("data-minimized")).toBe("false");
    expect(screen.getByLabelText("Replay controls")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Minimize Overlay controls" }));
    expect(overlayWidget.getAttribute("data-minimized")).toBe("true");
    expect(screen.getAllByText("Overlays").length).toBeGreaterThan(0);
  });

  it("auto-compacts visual widgets and clears overlay clutter while the camera moves", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/dev/trades-hall-visual"]}>
        <TradesHallVisualPage />
      </MemoryRouter>,
    );

    expect(container.querySelector(".visual-flow-line")).not.toBeNull();
    const layerWidget = container.querySelector<HTMLElement>("[data-floating-widget-id='visual-layer-controls']");
    const routeCallout = container.querySelector<HTMLElement>("[data-floating-widget-id='visual-callout-route-clearance-a']");
    expect(layerWidget?.getAttribute("data-auto-compact")).toBe("false");
    expect(routeCallout?.getAttribute("data-auto-compact")).toBe("false");

    const latestCall = orbitControlsMock.mock.calls[orbitControlsMock.mock.calls.length - 1];
    const controlsProps = latestCall?.[0];
    const onStart = controlsProps?.["onStart"];
    if (typeof onStart !== "function") {
      throw new Error("Visual camera controls must expose an onStart handler.");
    }

    act(() => {
      (onStart as () => void)();
    });

    expect(container.querySelector(".visual-flow-line")).toBeNull();
    expect(layerWidget?.getAttribute("data-auto-compact")).toBe("true");
    expect(routeCallout?.getAttribute("data-auto-compact")).toBe("true");
    expect(routeCallout?.getAttribute("data-minimized")).toBe("false");
  });

  it("allows the event phase graph to select a phase", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Bar queue/i }));
    expect(screen.getByText(/Grand Hall \/ Bar queue/i)).toBeTruthy();
  });

  it("renders real event phase data when an event id is provided", async () => {
    mount("/dev/trades-hall-visual?eventId=00000000-0000-4000-8000-000000000001");

    await waitFor(() => {
      expect(getEventPhaseGraphMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
      expect(screen.getByText("Live event phase data")).toBeTruthy();
    });
    expect(screen.getByText("Dinner service")).toBeTruthy();
    expect(screen.getByText("Guests 120 guests")).toBeTruthy();
    expect(screen.getByText("Ops tasks 7")).toBeTruthy();
    expect(screen.getByText("Review gates 2")).toBeTruthy();
    expect(screen.getAllByText(/Density not checked/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Staff conflicts not checked/i).length).toBeGreaterThan(0);
  });

  it("lets insight cards change the active command mode", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Ops Compiler/i }));
    expect(screen.getByRole("button", { name: "Ops" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps fixture-only Spark sources out of the command shell source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve("src/pages/TradesHallVisualPage.tsx"), "utf-8");
    expect(source).not.toContain("textSplats");
  });

  it("does not wire manual runtime asset URLs into the room visual route", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve("src/pages/TradesHallVisualPage.tsx"), "utf-8");
    expect(source).not.toContain("MANUAL_RUNTIME_ASSET_OVERRIDE_ENABLED");
    expect(source).not.toContain("runtimeSplatUrlFromSearchParams");
    expect(source).not.toContain("setSearchParams");
    expect(source).toContain("Manual runtime URLs are disabled here");
  });
});
