import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import {
  GRAND_HALL_ROOM_ONLY_RUNTIME_DECISION_ID,
  GRAND_HALL_ROOM_ONLY_RUNTIME_LOD_SELECTION_POLICY,
  type EventPhaseGraph,
  type EvidenceTargetType,
  type RuntimePackage,
  type TruthModeSummary,
} from "@omnitwin/types";
import { syntheticGrandHallRoomOnlyEvidence } from "../test-fixtures/grand-hall-room-only-evidence.js";
import { TRADES_HALL_VISUAL_DEMO_STATE } from "../lib/trades-hall-visual-demo-state.js";

type OrbitControlsMockProps = Readonly<Record<string, unknown>>;
type CanvasMockProps = Readonly<{
  children?: React.ReactNode;
  frameloop?: unknown;
  dpr?: unknown;
  gl?: unknown;
  performance?: unknown;
}>;

interface ExactGrandHallSplatLayerMockProps {
  readonly runtimePackageId: string;
  readonly onChunkLoaded?: (memberName: string) => void;
  readonly onChunkFailed?: (memberName: string) => void;
  readonly onFailed?: () => void;
  readonly onAdmission?: (summary: {
    readonly memberNames: readonly string[];
    readonly totalBytes: number;
    readonly totalGaussianCount: number;
  }) => void;
  readonly onReady?: () => void;
}

const SYNTHETIC_ROOM_ONLY_EVIDENCE = syntheticGrandHallRoomOnlyEvidence();
const SYNTHETIC_CROPPED_MEMBERS = SYNTHETIC_ROOM_ONLY_EVIDENCE.croppedVisual.members;
const SYNTHETIC_ADMISSION_SUMMARY = {
  memberNames: SYNTHETIC_CROPPED_MEMBERS.map((member) => member.fileName),
  totalBytes: SYNTHETIC_ROOM_ONLY_EVIDENCE.croppedVisual.totalBytes,
  totalGaussianCount: SYNTHETIC_ROOM_ONLY_EVIDENCE.croppedVisual.totalGaussianCount,
} as const;

const EXPLICIT_RUNTIME_PACKAGE_A = "30000000-0000-4000-8000-000000000001";
const EXPLICIT_RUNTIME_PACKAGE_B = "30000000-0000-4000-8000-000000000002";

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

const { runGuestFlowReplayInBrowserMock } = vi.hoisted(() => ({
  runGuestFlowReplayInBrowserMock: vi.fn(),
}));

const { orbitControlsMock } = vi.hoisted(() => ({
  orbitControlsMock: vi.fn<(props: OrbitControlsMockProps) => void>(),
}));

const { exactGrandHallSplatLayerMock } = vi.hoisted(() => ({
  exactGrandHallSplatLayerMock: vi.fn<(props: ExactGrandHallSplatLayerMockProps) => void>(),
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
  SparkSplatLayer: ({ url }: { readonly url: string }) => (
    <div data-testid="spark-splat-layer">{url}</div>
  ),
}));

vi.mock("../components/editor/ExactGrandHallSplatLayer.js", () => ({
  ExactGrandHallSplatLayer: (props: ExactGrandHallSplatLayerMockProps) => {
    exactGrandHallSplatLayerMock(props);
    return <div data-testid="exact-grand-hall-splat-layer">{props.runtimePackageId}</div>;
  },
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

vi.mock("../lib/guest-flow-replay-worker.js", () => ({
  runGuestFlowReplayInBrowser: runGuestFlowReplayInBrowserMock,
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

function VisualRouteSwitcher(): React.ReactElement {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() => { void navigate("/dev/trades-hall-visual?venue=trades-hall&room=grand-hall"); }}
      >
        Open Grand Hall
      </button>
      <TradesHallVisualPage />
    </>
  );
}

function RuntimePackagePreviewRouteSwitcher(): React.ReactElement {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void navigate(
            `/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&runtimePackageId=${EXPLICIT_RUNTIME_PACKAGE_A}`,
          );
        }}
      >
        Open package A
      </button>
      <button
        type="button"
        onClick={() => {
          void navigate(
            `/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&runtimePackageId=${EXPLICIT_RUNTIME_PACKAGE_B}`,
          );
        }}
      >
        Open package B
      </button>
      <button
        type="button"
        onClick={() => {
          void navigate("/dev/trades-hall-visual?venue=trades-hall&room=grand-hall");
        }}
      >
        Use latest package
      </button>
      <TradesHallVisualPage />
    </>
  );
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1440,
  });
  getLatestRuntimePackageMock.mockResolvedValue(null);
  getEventPhaseGraphMock.mockResolvedValue(makePhaseGraph());
  getLatestGuestFlowReplayMock.mockRejectedValue(new Error("No stored replay in component test."));
  runGuestFlowReplayInBrowserMock.mockResolvedValue({
    artifact: TRADES_HALL_VISUAL_DEMO_STATE.guestFlowReplay,
    mode: "main-thread-fallback",
  });
  getTruthModeSummaryMock.mockImplementation(
    (input: { readonly targetType: EvidenceTargetType; readonly targetId: string }) =>
      Promise.resolve(makeTruthSummary(input.targetType, input.targetId)),
  );
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  getLatestRuntimePackageMock.mockReset();
  getEventPhaseGraphMock.mockReset();
  getLatestGuestFlowReplayMock.mockReset();
  runGuestFlowReplayInBrowserMock.mockReset();
  getTruthModeSummaryMock.mockReset();
  orbitControlsMock.mockReset();
  exactGrandHallSplatLayerMock.mockReset();
});

function latestExactGrandHallLayerProps(): ExactGrandHallSplatLayerMockProps {
  const props = exactGrandHallSplatLayerMock.mock.lastCall?.[0];
  if (props === undefined) {
    throw new Error("Expected the exact Grand Hall layer to have rendered.");
  }
  return props;
}

function exactGrandHallLayerPropsFor(runtimePackageId: string): ExactGrandHallSplatLayerMockProps {
  const call = [...exactGrandHallSplatLayerMock.mock.calls]
    .reverse()
    .find(([props]) => props.runtimePackageId === runtimePackageId);
  const props = call?.[0];
  if (props === undefined) {
    throw new Error(`Expected the exact Grand Hall layer to render package ${runtimePackageId}.`);
  }
  return props;
}

function expectNoArchitectureMounted(): void {
  expect(screen.queryByTestId("exact-grand-hall-splat-layer")).toBeNull();
  expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
  expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
  expect(screen.queryByTestId("grand-hall-room")).toBeNull();
}

function mount(initialEntry = "/dev/trades-hall-visual"): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TradesHallVisualPage />
    </MemoryRouter>,
  );
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

function makeExactGrandHallRuntimePackage(): RuntimePackage {
  const assetVersionIds = SYNTHETIC_CROPPED_MEMBERS.map((_, index) =>
    `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  const firstMember = SYNTHETIC_CROPPED_MEMBERS[0];
  const firstAssetVersionId = assetVersionIds[0];
  if (firstAssetVersionId === undefined || firstMember === undefined) {
    throw new Error("Grand Hall source contract must contain a primary member.");
  }
  const visualAssetReceipts = SYNTHETIC_CROPPED_MEMBERS.map((member, index) => ({
    assetVersionId: assetVersionIds[index] ?? "",
    fileName: member.fileName,
    fileExt: ".sog" as const,
    sha256: member.sha256,
    sizeBytes: member.sizeBytes,
    storageKeySha256: String(index + 1).padStart(2, "0").repeat(32),
  }));

  return {
    id: "20000000-0000-4000-8000-000000000001",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    primaryVisualAssetVersionId: firstAssetVersionId,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: firstAssetVersionId,
        visualAssetVersionIds: assetVersionIds,
        visualAssetReceipts,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
      compositionBasis: {
        decisionId: GRAND_HALL_ROOM_ONLY_RUNTIME_DECISION_ID,
        decisionRef: `sha256:${SYNTHETIC_ROOM_ONLY_EVIDENCE.evidenceSha256}`,
        hierarchySha256: SYNTHETIC_ROOM_ONLY_EVIDENCE.croppedVisual.memberSetSha256,
        format: "sog",
        level: "fine",
        lodSelectionPolicy: GRAND_HALL_ROOM_ONLY_RUNTIME_LOD_SELECTION_POLICY,
        expectedGaussianCount: SYNTHETIC_ROOM_ONLY_EVIDENCE.croppedVisual.totalGaussianCount,
      },
      roomOnlyEvidence: SYNTHETIC_ROOM_ONLY_EVIDENCE,
    },
    evidenceStatus: "human_reviewed",
    runtimeStatus: "published",
    createdAt: "2026-08-21T12:00:00.000Z",
    updatedAt: "2026-08-21T12:00:00.000Z",
    primaryVisualAssetUrl: "https://untrusted.invalid/primary.sog",
    visualAssetUrls: SYNTHETIC_CROPPED_MEMBERS.map(
      (member) => `https://untrusted.invalid/${member.fileName}`,
    ),
    primaryVisualAssetVersion: {
      id: firstAssetVersionId,
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      captureSessionId: null,
      assetKind: "splat",
      sourceType: "xgrids",
      r2Key: `venues/trades-hall/rooms/grand-hall/${firstMember.fileName}`,
      fileName: firstMember.fileName,
      fileExt: ".sog",
      externalUrl: null,
      mimeType: "application/octet-stream",
      sha256: firstMember.sha256,
      sizeBytes: firstMember.sizeBytes,
      evidenceStatus: "human_reviewed",
      runtimeStatus: "usable",
      notes: null,
      createdAt: "2026-08-21T12:00:00.000Z",
      updatedAt: "2026-08-21T12:00:00.000Z",
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

  it("renders a source-only Grand Hall empty state without planner or demo leakage", async () => {
    mount();
    expect(screen.getByText("Venviewer")).toBeTruthy();
    expect(screen.getByText("Captured source inspection")).toBeTruthy();
    expect(screen.queryByText("Truth Mode")).toBeNull();
    expect(screen.queryByText("Event Phase Graph")).toBeNull();
    expect(screen.queryByText("Linked event timeline")).toBeNull();
    expect(screen.queryByText("Guest Flow Replay")).toBeNull();
    expect(screen.queryByLabelText("Visual command modes")).toBeNull();
    expect(screen.queryByLabelText("Visual insight cards")).toBeNull();
    expect(screen.queryByLabelText("Guest flow replay status")).toBeNull();
    expect(screen.queryByLabelText("Truth Mode selection")).toBeNull();
    expect(screen.queryByRole("button", { name: "Selected table" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Selected route" })).toBeNull();
    expect(screen.queryByText("Overlays")).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand Overlay controls" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Splat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mesh" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hybrid" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand View status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "3D view" })).toBeNull();
    expect(screen.queryByRole("button", { name: "2D view" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Current mode/i })).toBeNull();
    expect(document.querySelector(".visual-flow-line")).toBeNull();
    expect(screen.queryByLabelText("Replay controls")).toBeNull();
    expect(screen.queryByText("Internal command shell demo")).toBeNull();
    expect(screen.queryByText("Internal demo phase fixture")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Guests \d|Density|Staff conflicts|Ops tasks/i);
    expect(screen.getAllByText("No real asset loaded yet").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
    expect(screen.queryByTestId("exact-grand-hall-splat-layer")).toBeNull();
    expect(document.querySelector(".visual-canvas-frame--captured-source")).not.toBeNull();

    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "grand-hall",
      });
    });
    expect(getLatestGuestFlowReplayMock).not.toHaveBeenCalled();
    expect(runGuestFlowReplayInBrowserMock).not.toHaveBeenCalled();
    expect(getTruthModeSummaryMock).not.toHaveBeenCalled();
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

  it("mounts a valid explicit Grand Hall package without latest discovery or URL-sourced architecture", async () => {
    mount(
      `/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&runtimePackageId=${EXPLICIT_RUNTIME_PACKAGE_A}`
        + "&splatUrl=https%3A%2F%2Funtrusted.invalid%2Finvented.sog",
    );

    await waitFor(() => {
      expect(screen.getByTestId("exact-grand-hall-splat-layer").textContent).toBe(
        EXPLICIT_RUNTIME_PACKAGE_A,
      );
    });

    expect(getLatestRuntimePackageMock).not.toHaveBeenCalled();
    expect(screen.getByText("Captured source inspection")).toBeTruthy();
    expect(screen.getAllByText(EXPLICIT_RUNTIME_PACKAGE_A).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();
    expect(document.body.textContent).not.toContain("untrusted.invalid");
  });

  it.each([
    [
      "malformed",
      "/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&runtimePackageId=not-a-package-id",
    ],
    [
      "duplicate",
      `/dev/trades-hall-visual?venue=trades-hall&room=grand-hall`
        + `&runtimePackageId=${EXPLICIT_RUNTIME_PACKAGE_A}`
        + `&runtimePackageId=${EXPLICIT_RUNTIME_PACKAGE_B}`,
    ],
  ])("fails closed for a %s explicit package selector", async (_caseName, initialEntry) => {
    mount(initialEntry);

    await act(async () => { await Promise.resolve(); });

    expect(getLatestRuntimePackageMock).not.toHaveBeenCalled();
    expect(exactGrandHallSplatLayerMock).not.toHaveBeenCalled();
    expectNoArchitectureMounted();
    expect(screen.getByText("Captured source inspection")).toBeTruthy();
  });

  it.each([
    ["another room", "venue=trades-hall&room=reception-room"],
    ["another venue", "venue=city-hall&room=grand-hall"],
  ])("fails closed when an explicit package selector targets %s", async (_caseName, targetQuery) => {
    mount(
      `/dev/trades-hall-visual?${targetQuery}&runtimePackageId=${EXPLICIT_RUNTIME_PACKAGE_A}`,
    );

    await act(async () => { await Promise.resolve(); });

    expect(getLatestRuntimePackageMock).not.toHaveBeenCalled();
    expect(exactGrandHallSplatLayerMock).not.toHaveBeenCalled();
    expectNoArchitectureMounted();
  });

  it("resets verification when the explicit package changes and ignores stale package callbacks", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          `/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&runtimePackageId=${EXPLICIT_RUNTIME_PACKAGE_A}`,
        ]}
      >
        <RuntimePackagePreviewRouteSwitcher />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("exact-grand-hall-splat-layer").textContent).toBe(
        EXPLICIT_RUNTIME_PACKAGE_A,
      );
    });
    const packageAProps = exactGrandHallLayerPropsFor(EXPLICIT_RUNTIME_PACKAGE_A);
    const packageAChunkLoaded = packageAProps.onChunkLoaded;
    const packageAChunkFailed = packageAProps.onChunkFailed;
    const packageAReady = packageAProps.onReady;
    const packageAAdmission = packageAProps.onAdmission;
    if (
      packageAChunkLoaded === undefined
      || packageAChunkFailed === undefined
      || packageAReady === undefined
      || packageAAdmission === undefined
    ) {
      throw new Error("Expected package A verification callbacks.");
    }
    act(() => {
      packageAAdmission(SYNTHETIC_ADMISSION_SUMMARY);
      for (const member of SYNTHETIC_CROPPED_MEMBERS) {
        packageAChunkLoaded(member.fileName);
      }
      packageAReady();
    });
    await waitFor(() => {
      expect(screen.getByText("The exact receipt-bound captured Grand Hall source is mounted.")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open package B" }));

    await waitFor(() => {
      expect(screen.getByTestId("exact-grand-hall-splat-layer").textContent).toBe(
        EXPLICIT_RUNTIME_PACKAGE_B,
      );
      expect(screen.getAllByText("Verifying accepted Grand Hall room-only inventory metadata").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("The exact receipt-bound captured Grand Hall source is mounted.")).toBeNull();

    act(() => {
      for (const member of SYNTHETIC_CROPPED_MEMBERS) {
        packageAChunkLoaded(member.fileName);
      }
      packageAChunkFailed(SYNTHETIC_CROPPED_MEMBERS[0]?.fileName ?? "missing-member");
    });

    await waitFor(() => {
      expect(screen.getAllByText("Verifying accepted Grand Hall room-only inventory metadata").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("The exact receipt-bound captured Grand Hall source is mounted.")).toBeNull();
    expect(screen.queryByText("The exact captured Grand Hall source failed verification and is not mounted.")).toBeNull();
    expect(getLatestRuntimePackageMock).not.toHaveBeenCalled();
  });

  it("restores latest-package discovery when the explicit selector is removed", async () => {
    const latestPackage = makeExactGrandHallRuntimePackage();
    getLatestRuntimePackageMock.mockResolvedValue(latestPackage);
    render(
      <MemoryRouter
        initialEntries={[
          `/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&runtimePackageId=${EXPLICIT_RUNTIME_PACKAGE_A}`,
        ]}
      >
        <RuntimePackagePreviewRouteSwitcher />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("exact-grand-hall-splat-layer").textContent).toBe(
        EXPLICIT_RUNTIME_PACKAGE_A,
      );
    });
    expect(getLatestRuntimePackageMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Use latest package" }));

    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledTimes(1);
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "grand-hall",
      });
      expect(screen.getByTestId("exact-grand-hall-splat-layer").textContent).toBe(latestPackage.id);
    });
    expect(screen.getAllByText(latestPackage.id).length).toBeGreaterThan(0);
  });

  it("loads Truth Mode summary for the selected table by default", async () => {
    mount("/dev/trades-hall-visual?venue=trades-hall&room=reception-room");
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
    mount("/dev/trades-hall-visual?venue=trades-hall&room=reception-room");
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

  it("removes the previous room package immediately while Grand Hall is still pending", async () => {
    let resolveGrandHall: ((value: RuntimePackage | null) => void) | null = null;
    getLatestRuntimePackageMock.mockImplementation(({ room }: { readonly room: string }) => {
      if (room === "reception-room") return Promise.resolve(makeRuntimePackage("reception-room"));
      return new Promise<RuntimePackage | null>((resolve) => { resolveGrandHall = resolve; });
    });
    render(
      <MemoryRouter initialEntries={["/dev/trades-hall-visual?venue=trades-hall&room=reception-room"]}>
        <VisualRouteSwitcher />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("spark-splat-layer").textContent).toContain("reception-room");
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Grand Hall" }));

    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({ venue: "trades-hall", room: "grand-hall" });
    });
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
    expect(screen.queryByTestId("exact-grand-hall-splat-layer")).toBeNull();
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();

    act(() => { resolveGrandHall?.(null); });
  });

  it("mounts the exact Grand Hall transport without procedural or generic URL architecture", async () => {
    getLatestRuntimePackageMock.mockResolvedValue(makeExactGrandHallRuntimePackage());
    mount();

    await waitFor(() => {
      expect(screen.getByTestId("exact-grand-hall-splat-layer").textContent).toBe(
        "20000000-0000-4000-8000-000000000001",
      );
    });
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand Overlay controls" })).toBeNull();
    expect(screen.queryByText(/No runtime visual asset is mounted for this room/i)).toBeNull();
  });

  it("renders a discovered legacy v1 Grand Hall package blank without URL or procedural fallback", async () => {
    const legacy = makeExactGrandHallRuntimePackage();
    delete legacy.manifestJson.roomOnlyEvidence;
    getLatestRuntimePackageMock.mockResolvedValue(legacy);
    mount();

    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalledWith({
        venue: "trades-hall",
        room: "grand-hall",
      });
    });
    await act(async () => { await Promise.resolve(); });

    expect(exactGrandHallSplatLayerMock).not.toHaveBeenCalled();
    expectNoArchitectureMounted();
    expect(document.body.textContent).not.toContain("untrusted.invalid");
  });

  it("keeps exact Grand Hall Truth Mode pending until the accepted inventory attaches", async () => {
    getLatestRuntimePackageMock.mockResolvedValue(makeExactGrandHallRuntimePackage());
    getTruthModeSummaryMock.mockRejectedValue(new Error("No stored runtime-asset summary."));
    mount();

    await waitFor(() => {
      expect(screen.getByText("The exact captured Grand Hall source is still verifying and is not mounted.")).toBeTruthy();
    });
    expect(screen.queryByText("The exact receipt-bound captured Grand Hall source is mounted.")).toBeNull();
    expect(screen.queryByText(/Captured source pixels are shown/i)).toBeNull();

    const onChunkLoaded = latestExactGrandHallLayerProps().onChunkLoaded;
    if (onChunkLoaded === undefined) {
      throw new Error("Expected an exact Grand Hall loaded callback.");
    }
    act(() => {
      for (const member of SYNTHETIC_CROPPED_MEMBERS.slice(0, -1)) {
        onChunkLoaded(member.fileName);
      }
    });

    await waitFor(() => {
      expect(screen.getAllByText("Verifying accepted Grand Hall cropped output (1/2)").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("The exact captured Grand Hall source is still verifying and is not mounted.")).toBeTruthy();
    expect(screen.queryByText("The exact receipt-bound captured Grand Hall source is mounted.")).toBeNull();
    expect(screen.queryByText(/Captured source pixels are shown/i)).toBeNull();
  });

  it("enters a terminal hidden state when exact metadata fails before admission", async () => {
    getLatestRuntimePackageMock.mockResolvedValue(makeExactGrandHallRuntimePackage());
    mount();

    await waitFor(() => {
      expect(screen.getByTestId("exact-grand-hall-splat-layer")).toBeTruthy();
    });
    const onFailed = latestExactGrandHallLayerProps().onFailed;
    if (onFailed === undefined) {
      throw new Error("Expected the exact Grand Hall terminal failure callback.");
    }
    act(() => { onFailed(); });

    await waitFor(() => {
      expect(screen.getByText(
        "The exact captured Grand Hall source failed verification and is not mounted.",
      )).toBeTruthy();
    });
    expect(document.querySelector("header")?.textContent).toContain(
      "The exact Grand Hall source could not be verified; architecture is hidden.",
    );
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();
  });

  it("enters a terminal hidden state when exact transfer fails after one member", async () => {
    getLatestRuntimePackageMock.mockResolvedValue(makeExactGrandHallRuntimePackage());
    mount();

    await waitFor(() => {
      expect(screen.getByTestId("exact-grand-hall-splat-layer")).toBeTruthy();
    });
    const { onAdmission, onChunkLoaded, onFailed } = latestExactGrandHallLayerProps();
    if (onAdmission === undefined || onChunkLoaded === undefined || onFailed === undefined) {
      throw new Error("Expected exact Grand Hall admission, progress, and failure callbacks.");
    }
    const firstMember = SYNTHETIC_CROPPED_MEMBERS[0];
    if (firstMember === undefined) throw new Error("Expected a first cropped member.");
    act(() => {
      onAdmission(SYNTHETIC_ADMISSION_SUMMARY);
      onChunkLoaded(firstMember.fileName);
    });
    await waitFor(() => {
      expect(screen.getAllByText(
        "Verifying accepted Grand Hall cropped output (1/2)",
      ).length).toBeGreaterThan(0);
    });

    act(() => { onFailed(); });

    await waitFor(() => {
      expect(screen.getByText(
        "The exact captured Grand Hall source failed verification and is not mounted.",
      )).toBeTruthy();
    });
    expect(document.querySelector("header")?.textContent).toContain(
      "The exact Grand Hall source could not be verified; architecture is hidden.",
    );
    expect(screen.queryByText(/Captured source pixels are shown/i)).toBeNull();
  });

  it("revokes exact Grand Hall mounted and pixel claims after a verification failure", async () => {
    getLatestRuntimePackageMock.mockResolvedValue(makeExactGrandHallRuntimePackage());
    getTruthModeSummaryMock.mockRejectedValue(new Error("No stored runtime-asset summary."));
    mount();

    await waitFor(() => {
      expect(screen.getByTestId("exact-grand-hall-splat-layer")).toBeTruthy();
    });
    const layerProps = latestExactGrandHallLayerProps();
    const { onChunkLoaded, onChunkFailed, onReady } = layerProps;
    if (onChunkLoaded === undefined || onChunkFailed === undefined || onReady === undefined) {
      throw new Error("Expected exact Grand Hall load and failure callbacks.");
    }
    act(() => {
      for (const member of SYNTHETIC_CROPPED_MEMBERS) {
        onChunkLoaded(member.fileName);
      }
      onReady();
    });

    await waitFor(() => {
      expect(screen.getByText("The exact receipt-bound captured Grand Hall source is mounted.")).toBeTruthy();
      expect(screen.getByText(/Captured source pixels are shown/i)).toBeTruthy();
    });

    act(() => {
      onChunkFailed(SYNTHETIC_CROPPED_MEMBERS[0]?.fileName ?? "missing-member");
    });

    await waitFor(() => {
      expect(screen.getByText("The exact captured Grand Hall source failed verification and is not mounted.")).toBeTruthy();
      expect(screen.getByText(/Captured pixels and all architectural fallbacks remain hidden/i)).toBeTruthy();
    });
    expect(document.querySelector("header")?.textContent).toContain(
      "The exact Grand Hall source could not be verified; architecture is hidden.",
    );
    expect(screen.queryByText("The exact receipt-bound captured Grand Hall source is mounted.")).toBeNull();
    expect(screen.queryByText(/Captured source pixels are shown/i)).toBeNull();
  });

  it("ignores manual splatUrl query params and keeps Grand Hall architecture hidden", () => {
    mount("/dev/trades-hall-visual?splatUrl=https%3A%2F%2Fassets.venviewer.test%2Fscene.ply");
    expect(screen.queryByTestId("spark-splat-layer")).toBeNull();
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();
    expect(screen.getAllByText("No real asset loaded yet").length).toBeGreaterThan(0);
    expect(screen.getByText("Captured source inspection")).toBeTruthy();
    expect(document.body.textContent).not.toContain("assets.venviewer.test");
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
    mount("/dev/trades-hall-visual?venue=trades-hall&room=reception-room");
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
    mount("/dev/trades-hall-visual?venue=trades-hall&room=reception-room");
    expect(screen.getByRole("button", { name: /Hybrid/i }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Splat/i }));
    expect(screen.getByRole("button", { name: /Splat/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("visual-room-mesh")).toBeNull();
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Mesh/i }));
    expect(screen.getByRole("button", { name: /Mesh/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("visual-room-mesh").getAttribute("data-detail")).toBe("lean");
    expect(screen.getByTestId("visual-room-mesh").getAttribute("data-variant")).toBe("generic");
    expect(screen.queryByTestId("grand-hall-room")).toBeNull();
  });

  it("does not apply the Trades Hall capture lock to another venue's grand-hall slug", () => {
    mount("/dev/trades-hall-visual?venue=city-hall&room=grand-hall");

    expect(screen.getByRole("button", { name: "Hybrid" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Mesh" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Hybrid" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("visual-room-mesh").getAttribute("data-variant")).toBe("grand-hall");
    expect(screen.getByRole("button", { name: "Expand Overlay controls" })).toBeTruthy();
  });

  it("lets operators minimize floating controls and callouts", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/dev/trades-hall-visual?venue=trades-hall&room=reception-room"]}>
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
      <MemoryRouter initialEntries={["/dev/trades-hall-visual?venue=trades-hall&room=reception-room"]}>
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
    mount("/dev/trades-hall-visual?venue=trades-hall&room=reception-room");
    fireEvent.click(screen.getByRole("button", { name: /Bar queue/i }));
    expect(screen.getByText(/Reception Room \/ Bar queue/i)).toBeTruthy();
  });

  it("renders real event phase data when an event id is provided", async () => {
    mount("/dev/trades-hall-visual?venue=trades-hall&room=reception-room&eventId=00000000-0000-4000-8000-000000000001");

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
    mount("/dev/trades-hall-visual?venue=trades-hall&room=reception-room");
    fireEvent.click(screen.getByRole("button", { name: /Ops Compiler/i }));
    expect(screen.getByRole("button", { name: "Ops" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows only a minimal timeline for a genuinely linked Grand Hall event", async () => {
    mount("/dev/trades-hall-visual?eventId=00000000-0000-4000-8000-000000000001");

    await waitFor(() => {
      expect(getEventPhaseGraphMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
      expect(screen.getByText("Linked event timeline")).toBeTruthy();
      expect(screen.getByText("Dinner service")).toBeTruthy();
    });
    expect(screen.getByText("Live event phase data")).toBeTruthy();
    expect(screen.getByText("Starts 19:00")).toBeTruthy();
    expect(screen.getByText("Duration 1h 30m")).toBeTruthy();
    expect(screen.queryByText("Guests 120 guests")).toBeNull();
    expect(screen.queryByText("Ops tasks 7")).toBeNull();
    expect(screen.queryByText("Review gates 2")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Density not checked|Staff conflicts not checked/i);
    expect(screen.queryByLabelText("Guest flow replay status")).toBeNull();
    expect(screen.queryByLabelText("Visual insight cards")).toBeNull();
    expect(getLatestGuestFlowReplayMock).not.toHaveBeenCalled();
    expect(runGuestFlowReplayInBrowserMock).not.toHaveBeenCalled();
  });

  it("does not treat an invalid Grand Hall event id as a linked timeline", async () => {
    mount("/dev/trades-hall-visual?eventId=not-a-uuid");

    await waitFor(() => {
      expect(getLatestRuntimePackageMock).toHaveBeenCalled();
    });
    expect(getEventPhaseGraphMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Linked event timeline")).toBeNull();
    expect(screen.queryByText("Internal demo phase fixture")).toBeNull();
  });

  it("keeps the generic canvas grade off the exact captured source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const css = await fs.readFile(path.resolve("src/pages/TradesHallVisualPage.css"), "utf-8");
    expect(css).toMatch(/\.visual-canvas-frame--captured-source\s+canvas\s*\{\s*filter:\s*none;/u);
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
