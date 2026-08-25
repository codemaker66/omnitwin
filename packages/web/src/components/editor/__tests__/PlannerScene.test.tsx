import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { Children, isValidElement, type ReactNode } from "react";
import type { PlannerRoomIdentity } from "../../../lib/planner-layer-composition.js";
import type { ExactGrandHallRuntimeKey } from "../../../stores/cockpit-store.js";
import { syntheticGrandHallRoomOnlyEvidence } from "../../../test-fixtures/grand-hall-room-only-evidence.js";

type CanvasMockProps = Readonly<{
  dpr?: unknown;
  frameloop?: unknown;
  children?: ReactNode;
}>;

function sceneElementLabels(node: ReactNode): readonly string[] {
  const labels: string[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<{ readonly children?: ReactNode; readonly name?: string }>(child)) return;
    const type = child.type;
    const label = typeof type === "string"
      ? child.props.name === undefined ? type : `${type}:${child.props.name}`
      : typeof type === "function"
        ? (type as { readonly displayName?: string; readonly name?: string }).displayName
          ?? (type as { readonly name?: string }).name
          ?? "anonymous"
        : "fragment";
    labels.push(label);
    labels.push(...sceneElementLabels(child.props.children));
  });
  return labels;
}

// Mock the R3F Canvas to render an empty host div: the scene children are
// constructed as React elements but never mounted, so their useThree/useFrame
// hooks don't run outside a real Canvas. This keeps the test a structural
// smoke test that PlannerScene mounts its canvas host.
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ dpr, frameloop, children }: CanvasMockProps) => (
    <div
      data-testid="r3f-canvas"
      data-dpr={JSON.stringify(dpr)}
      data-frameloop={typeof frameloop === "string" ? frameloop : ""}
      data-scene-elements={sceneElementLabels(children).join("|")}
    />
  ),
}));

// CockpitSplatLayer pulls in @sparkjsdev/spark, which instantiates a WASM
// module at import time and rejects under Node's test environment. Mock it so
// the splat renderer is never imported. (It sits inside the mocked Canvas and
// never mounts here — chunk-arrival semantics are covered by
// use-chunk-arrivals.test.ts, and the real callback plumbing by the
// plan-room-resolve e2e, which streams actual chunks.)
vi.mock("../CockpitSplatLayer.js", () => ({
  CockpitSplatLayer: function CockpitSplatLayer() { return null; },
}));
vi.mock("../ExactGrandHallSplatLayer.js", () => ({
  ExactGrandHallSplatLayer: function ExactGrandHallSplatLayer() { return null; },
}));

const splatHookMock = vi.hoisted(() => ({ useRoomRuntimeSplat: vi.fn() }));
vi.mock("../../../hooks/use-room-runtime-splat.js", () => splatHookMock);

const IDENTITY_TRANSFORM = {
  position: [0, 0, 0] as const,
  rotation: [0, 0, 0] as const,
  scale: 1,
  note: "identity",
};

function mockSplat(overrides: {
  splatUrls?: readonly string[];
  hasAsset?: boolean;
  status?: "none" | "loading" | "loaded";
  delivery?: "none" | "verified-grand-hall" | "url";
  runtimePackageId?: string | null;
  exactGrandHallRuntimeKey?: ExactGrandHallRuntimeKey | null;
  exactGrandHallRoomOnlyEvidence?: ReturnType<typeof syntheticGrandHallRoomOnlyEvidence> | null;
  exactGrandHallMemberNames?: readonly string[];
  roomIdentity?: PlannerRoomIdentity | null;
} = {}): void {
  splatHookMock.useRoomRuntimeSplat.mockReturnValue({
    splatUrls: overrides.splatUrls ?? [],
    transform: IDENTITY_TRANSFORM,
    hasAsset: overrides.hasAsset ?? false,
    status: overrides.status ?? "none",
    delivery: overrides.delivery ?? "none",
    runtimePackageId: overrides.runtimePackageId ?? null,
    exactGrandHallRuntimeKey: overrides.exactGrandHallRuntimeKey ?? null,
    exactGrandHallRoomOnlyEvidence: overrides.exactGrandHallRoomOnlyEvidence ?? null,
    exactGrandHallMemberNames: overrides.exactGrandHallMemberNames ?? [],
    exactGrandHallTotalBytes: null,
    exactGrandHallGaussianCount: null,
    roomIdentity: overrides.roomIdentity ?? null,
  });
}

const {
  PlannerScene,
  exactGrandHallArrivalResetKey,
  plannerAdaptiveResolutionForViewportWidth,
  plannerCanvasDprForViewportWidth,
  plannerCanvasGlForViewportWidth,
  shouldRenderPlannerSceneOverlays,
  shouldUseSmoothPlannerControls,
  useExactGrandHallRuntimeCallbacks,
} = await import("../PlannerScene.js");
const { useCockpitStore } = await import("../../../stores/cockpit-store.js");
const { useEditorStore } = await import("../../../stores/editor-store.js");

const GRAND_HALL_SPACE = {
  id: "grand-hall-space",
  venueId: "trades-hall-venue",
  name: "Grand Hall",
  slug: "grand-hall",
  widthM: "21",
  lengthM: "10.5",
  heightM: "7",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
};

const VERIFIED_GRAND_HALL_IDENTITY: PlannerRoomIdentity = {
  spaceId: GRAND_HALL_SPACE.id,
  venueId: GRAND_HALL_SPACE.venueId,
  roomSlug: GRAND_HALL_SPACE.slug,
  status: "resolved",
  venueSlug: "trades-hall-glasgow",
};
const EXACT_GRAND_HALL_RUNTIME_KEY: ExactGrandHallRuntimeKey = {
  spaceId: GRAND_HALL_SPACE.id,
  venueId: GRAND_HALL_SPACE.venueId,
  roomSlug: "grand-hall",
  runtimePackageId: "20000000-0000-4000-8000-000000000001",
};

beforeEach(() => {
  useCockpitStore.getState().reset();
  useEditorStore.setState({ space: null });
  mockSplat();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlannerScene", () => {
  it("changes the exact arrival reset boundary for every room/package attempt", () => {
    const memberNames = ["crop-000.sog", "crop-001.sog"];
    const first = exactGrandHallArrivalResetKey(EXACT_GRAND_HALL_RUNTIME_KEY, 1, memberNames);
    const retry = exactGrandHallArrivalResetKey(EXACT_GRAND_HALL_RUNTIME_KEY, 2, memberNames);
    const nextPackage = exactGrandHallArrivalResetKey({
      ...EXACT_GRAND_HALL_RUNTIME_KEY,
      runtimePackageId: "20000000-0000-4000-8000-000000000002",
    }, 1, memberNames);

    expect(first).not.toBe(retry);
    expect(first).not.toBe(nextPackage);
    expect(first.split("|")).toHaveLength(2);
  });

  it("mounts an R3F canvas host", () => {
    const { container, getByTestId } = render(<PlannerScene />);
    expect(container.querySelector(".planner-scene-canvas-host")).not.toBeNull();
    expect(getByTestId("r3f-canvas")).toBeTruthy();
  });

  it("wires Grand Hall to the exact captured layer with zero procedural architecture or planning overlays", () => {
    useEditorStore.setState({ space: GRAND_HALL_SPACE });
    splatHookMock.useRoomRuntimeSplat.mockReturnValue({
      splatUrls: [],
      transform: IDENTITY_TRANSFORM,
      hasAsset: true,
      status: "loaded",
      delivery: "verified-grand-hall",
      runtimePackageId: "20000000-0000-4000-8000-000000000001",
      exactGrandHallRuntimeKey: EXACT_GRAND_HALL_RUNTIME_KEY,
      exactGrandHallRoomOnlyEvidence: syntheticGrandHallRoomOnlyEvidence(),
      exactGrandHallMemberNames: ["crop-000.sog", "crop-001.sog"],
      exactGrandHallTotalBytes: 78,
      exactGrandHallGaussianCount: 303,
      roomIdentity: VERIFIED_GRAND_HALL_IDENTITY,
    });

    const { getByTestId } = render(<PlannerScene />);
    const elements = getByTestId("r3f-canvas").getAttribute("data-scene-elements") ?? "";
    expect(elements).toContain("RoomSceneCompositor");
    expect(elements).not.toContain("group:captured-room-source");
    expect(elements).not.toContain("RoomMesh");
    expect(elements).not.toContain("GrandHallRoom");
    expect(elements).not.toContain("InkArchitectureLayer");
    expect(elements).not.toContain("group:planning-overlays");
    expect(elements).toContain("GrandHallCapturedCamera");
    expect(elements).not.toContain("CameraRig");
    expect(elements).not.toContain("CockpitCameraFocus");
    expect(elements).not.toContain("CockpitPlanningCamera");
    expect(elements).not.toContain("SectionPlane");
    expect(elements).not.toContain("InvalidateOnToggle");
    expect(elements).not.toContain("XrayToggle");
    expect(elements).not.toContain("fog");
  });

  it("fails closed for Grand Hall while venue identity is pending even if stale asset state exists", () => {
    useEditorStore.setState({ space: GRAND_HALL_SPACE });
    mockSplat({
      splatUrls: ["/stale.sog"],
      hasAsset: true,
      status: "loading",
      delivery: "url",
      roomIdentity: {
        ...VERIFIED_GRAND_HALL_IDENTITY,
        status: "pending",
        venueSlug: null,
      },
    });

    const { getByTestId } = render(<PlannerScene />);
    const elements = getByTestId("r3f-canvas").getAttribute("data-scene-elements") ?? "";
    expect(elements).not.toContain("RoomMesh");
    expect(elements).not.toContain("GrandHallRoom");
    expect(elements).not.toContain("InkArchitectureLayer");
    expect(elements).not.toContain("group:planning-overlays");
    expect(elements).not.toContain("ExactGrandHallSplatLayer");
    expect(elements).not.toContain("CameraRig");
    expect(elements).not.toContain("CockpitCameraFocus");
    expect(elements).not.toContain("CockpitPlanningCamera");
    expect(elements).not.toContain("SectionPlane");
    expect(elements).not.toContain("InvalidateOnToggle");
    expect(elements).not.toContain("XrayToggle");
    expect(elements).not.toContain("fog");
  });

  it("keeps verified Trades Hall Grand Hall source-only when its capture is unavailable", () => {
    useEditorStore.setState({ space: GRAND_HALL_SPACE });
    mockSplat({
      hasAsset: false,
      status: "none",
      roomIdentity: VERIFIED_GRAND_HALL_IDENTITY,
    });

    const { getByTestId } = render(<PlannerScene />);
    const elements = getByTestId("r3f-canvas").getAttribute("data-scene-elements") ?? "";
    expect(elements).not.toContain("RoomMesh");
    expect(elements).not.toContain("GrandHallRoom");
    expect(elements).not.toContain("InkArchitectureLayer");
    expect(elements).not.toContain("group:planning-overlays");
    expect(elements).not.toContain("group:captured-room-source");
    expect(elements).toContain("GrandHallCapturedCamera");
    expect(elements).not.toContain("CameraRig");
    expect(elements).not.toContain("CockpitCameraFocus");
    expect(elements).not.toContain("CockpitPlanningCamera");
  });

  it("does not reuse verified lifecycle state from another room key with the same package", async () => {
    useEditorStore.setState({ space: GRAND_HALL_SPACE });
    const evidence = syntheticGrandHallRoomOnlyEvidence();
    mockSplat({
      hasAsset: true,
      status: "loaded",
      delivery: "verified-grand-hall",
      runtimePackageId: EXACT_GRAND_HALL_RUNTIME_KEY.runtimePackageId,
      exactGrandHallRuntimeKey: EXACT_GRAND_HALL_RUNTIME_KEY,
      exactGrandHallRoomOnlyEvidence: evidence,
      exactGrandHallMemberNames: evidence.croppedVisual.members.map(
        (member) => member.fileName,
      ),
      roomIdentity: VERIFIED_GRAND_HALL_IDENTITY,
    });
    const staleKey = { ...EXACT_GRAND_HALL_RUNTIME_KEY, spaceId: "another-grand-hall-space" };
    const staleAttempt = useCockpitStore.getState().beginExactGrandHallRuntime(staleKey);
    useCockpitStore.getState().completeExactGrandHallRuntime(staleKey, staleAttempt, "verified");

    render(<PlannerScene />);

    await waitFor(() => {
      expect(useCockpitStore.getState().roomResolve.phase).toBe("developing");
    });
  });

  it("preserves normal procedural layers for another venue's grand-hall slug", () => {
    const otherGrandHall = {
      ...GRAND_HALL_SPACE,
      id: "other-grand-hall-space",
      venueId: "other-venue",
    };
    useEditorStore.setState({ space: otherGrandHall });
    mockSplat({
      hasAsset: false,
      status: "none",
      roomIdentity: {
        spaceId: otherGrandHall.id,
        venueId: otherGrandHall.venueId,
        roomSlug: otherGrandHall.slug,
        status: "resolved",
        venueSlug: "another-venue",
      },
    });

    const { getByTestId } = render(<PlannerScene />);
    const elements = getByTestId("r3f-canvas").getAttribute("data-scene-elements") ?? "";
    expect(elements).toContain("RoomMesh");
    expect(elements).toContain("InkArchitectureLayer");
    expect(elements).toContain("group:planning-overlays");
    expect(elements).toContain("CameraRig");
    expect(elements).toContain("CockpitCameraFocus");
    expect(elements).toContain("CockpitPlanningCamera");
    expect(elements).toContain("SectionPlane");
    expect(elements).toContain("InvalidateOnToggle");
    expect(elements).toContain("XrayToggle");
    expect(elements).toContain("fog");
    expect(elements).not.toContain("GrandHallCapturedCamera");
    expect(elements).not.toContain("ExactGrandHallSplatLayer");
  });

  it("caps planner canvas DPR across mobile, tablet, and desktop viewports", () => {
    expect(plannerCanvasDprForViewportWidth(390)).toEqual([0.75, 0.75]);
    expect(plannerCanvasDprForViewportWidth(768)).toEqual([0.75, 0.75]);
    expect(plannerCanvasDprForViewportWidth(1024)).toEqual([0.75, 0.75]);
    expect(plannerCanvasDprForViewportWidth(1440)).toEqual([0.75, 0.75]);
  });

  it("keeps adaptive DPR disabled during planner camera movement to avoid renderer resize stalls", () => {
    expect(plannerAdaptiveResolutionForViewportWidth(390)).toEqual({
      enabled: false,
      minDpr: 0.75,
      maxDpr: 0.75,
    });
    expect(plannerAdaptiveResolutionForViewportWidth(768)).toEqual({
      enabled: false,
      minDpr: 0.75,
      maxDpr: 0.75,
    });
    expect(plannerAdaptiveResolutionForViewportWidth(1440)).toEqual({
      enabled: false,
      minDpr: 0.75,
      maxDpr: 0.75,
    });
  });

  it("disables planner canvas antialiasing on mobile and tablet viewports", () => {
    expect(plannerCanvasGlForViewportWidth(390)).toEqual({
      antialias: false,
      powerPreference: "high-performance",
    });
    expect(plannerCanvasGlForViewportWidth(768)).toEqual({
      antialias: false,
      powerPreference: "high-performance",
    });
    expect(plannerCanvasGlForViewportWidth(1024)).toEqual({
      antialias: false,
      powerPreference: "high-performance",
    });
    expect(plannerCanvasGlForViewportWidth(1440)).toEqual({
      antialias: true,
      powerPreference: "high-performance",
    });
  });

  it("disables smooth planner camera controls on mobile and tablet viewports", () => {
    expect(shouldUseSmoothPlannerControls(390)).toBe(false);
    expect(shouldUseSmoothPlannerControls(768)).toBe(false);
    expect(shouldUseSmoothPlannerControls(1024)).toBe(false);
    expect(shouldUseSmoothPlannerControls(1440)).toBe(true);
  });

  it("omits animated cockpit scene overlays on mobile and tablet planner viewports", () => {
    expect(shouldRenderPlannerSceneOverlays(390)).toBe(false);
    expect(shouldRenderPlannerSceneOverlays(768)).toBe(false);
    expect(shouldRenderPlannerSceneOverlays(1024)).toBe(false);
    expect(shouldRenderPlannerSceneOverlays(1440)).toBe(true);
  });

  it("precompiles the planner scene so shader setup stays in the load window", async () => {
    const source = await readFile("src/components/editor/PlannerScene.tsx", "utf8");

    expect(source).toContain("function PlannerScenePrecompiler");
    expect(source).toContain("await gl.compileAsync(scene, camera)");
    expect(source).toContain("gl.compile(scene, camera)");
    expect(source).toContain("<PlannerScenePrecompiler signature={sceneWarmupSignature} />");
  });

  it("keys the exact renderer by the complete canonical room, venue, and package identity", async () => {
    const source = await readFile("src/components/editor/PlannerScene.tsx", "utf8");
    expect(source).toContain("serializeExactGrandHallRuntimeKey(exactGrandHallRuntimeKey)");
    expect(source).toContain("key={exactGrandHallRuntimeKey === null");
  });

});

describe("PlannerScene exact Grand Hall lifecycle callbacks", () => {
  it("publishes renderer success and failure for the active room/package key", () => {
    const firstAttempt = useCockpitStore.getState().beginExactGrandHallRuntime(EXACT_GRAND_HALL_RUNTIME_KEY);
    const { result, rerender } = renderHook(
      ({ attemptNonce }: { readonly attemptNonce: number }) => (
        useExactGrandHallRuntimeCallbacks(EXACT_GRAND_HALL_RUNTIME_KEY, attemptNonce)
      ),
      { initialProps: { attemptNonce: firstAttempt } },
    );

    act(() => { result.current.onReady(); });
    expect(useCockpitStore.getState().exactGrandHallRuntime?.status).toBe("verified");

    const secondAttempt = useCockpitStore.getState().beginExactGrandHallRuntime(EXACT_GRAND_HALL_RUNTIME_KEY);
    rerender({ attemptNonce: secondAttempt });
    act(() => { result.current.onFailed(); });
    expect(useCockpitStore.getState().exactGrandHallRuntime?.status).toBe("failed");
  });

  it("invalidates verified state on Canvas failure and requires post-attach readiness after retry", () => {
    useCockpitStore.getState().beginExactGrandHallRuntime(EXACT_GRAND_HALL_RUNTIME_KEY);
    const { result } = renderHook(() => {
      const lifecycle = useCockpitStore((state) => state.exactGrandHallRuntime);
      return useExactGrandHallRuntimeCallbacks(
        EXACT_GRAND_HALL_RUNTIME_KEY,
        lifecycle?.attemptNonce ?? 0,
      );
    });

    act(() => { result.current.onReady(); });
    expect(useCockpitStore.getState().exactGrandHallRuntime?.status).toBe("verified");

    act(() => { result.current.onSourceOnlyError(); });
    expect(useCockpitStore.getState().exactGrandHallRuntime).toBeNull();

    act(() => { result.current.onSourceOnlyRetry(); });
    expect(useCockpitStore.getState().exactGrandHallRuntime).toEqual({
      key: EXACT_GRAND_HALL_RUNTIME_KEY,
      status: "pending",
      attemptNonce: 2,
    });

    act(() => { result.current.onReady(); });
    expect(useCockpitStore.getState().exactGrandHallRuntime?.status).toBe("verified");
  });

  it("rejects a stale same-package retry callback after a newer attempt begins", () => {
    const firstAttempt = useCockpitStore.getState().beginExactGrandHallRuntime(EXACT_GRAND_HALL_RUNTIME_KEY);
    const { result, rerender } = renderHook(
      ({ attemptNonce }: { readonly attemptNonce: number }) => (
        useExactGrandHallRuntimeCallbacks(EXACT_GRAND_HALL_RUNTIME_KEY, attemptNonce)
      ),
      { initialProps: { attemptNonce: firstAttempt } },
    );
    const staleRetry = result.current.onSourceOnlyRetry;
    const secondAttempt = useCockpitStore.getState().beginExactGrandHallRuntime(EXACT_GRAND_HALL_RUNTIME_KEY);
    rerender({ attemptNonce: secondAttempt });

    act(() => { staleRetry(); });

    expect(useCockpitStore.getState().exactGrandHallRuntime?.attemptNonce).toBe(secondAttempt);
  });

  it("cannot publish a stale renderer callback after the runtime key changes", () => {
    const firstAttempt = useCockpitStore.getState().beginExactGrandHallRuntime(EXACT_GRAND_HALL_RUNTIME_KEY);
    const { result, rerender } = renderHook(
      ({ runtimeKey, attemptNonce }: {
        readonly runtimeKey: ExactGrandHallRuntimeKey;
        readonly attemptNonce: number;
      }) => (
        useExactGrandHallRuntimeCallbacks(runtimeKey, attemptNonce)
      ),
      { initialProps: { runtimeKey: EXACT_GRAND_HALL_RUNTIME_KEY, attemptNonce: firstAttempt } },
    );
    const staleReady = result.current.onReady;
    const staleRetry = result.current.onSourceOnlyRetry;
    const nextKey: ExactGrandHallRuntimeKey = {
      ...EXACT_GRAND_HALL_RUNTIME_KEY,
      runtimePackageId: "20000000-0000-4000-8000-000000000002",
    };
    const nextAttempt = useCockpitStore.getState().beginExactGrandHallRuntime(nextKey);
    rerender({ runtimeKey: nextKey, attemptNonce: nextAttempt });

    act(() => { staleReady(); });
    act(() => { staleRetry(); });
    expect(useCockpitStore.getState().exactGrandHallRuntime).toEqual({
      key: nextKey,
      status: "pending",
      attemptNonce: nextAttempt,
    });
  });
});

// CARD A2: the resolve choreography — PlannerScene derives the phase from the
// runtime-splat state plus chunk arrivals and publishes it to the cockpit
// store for the caption and the stage's honesty attribute.
describe("PlannerScene resolve phase wiring", () => {
  it("publishes 'ink' while the runtime package registry is resolving", async () => {
    mockSplat({ status: "loading" });
    render(<PlannerScene />);
    await waitFor(() => {
      expect(useCockpitStore.getState().roomResolve.phase).toBe("ink");
    });
  });

  it("publishes 'fallback' when resolution settles without a captured layer", async () => {
    mockSplat({ status: "none", hasAsset: false });
    render(<PlannerScene />);
    await waitFor(() => {
      expect(useCockpitStore.getState().roomResolve.phase).toBe("fallback");
    });
  });

  it("publishes 'developing' with honest chunk totals when a captured layer mounts", async () => {
    mockSplat({ status: "loaded", hasAsset: true, splatUrls: ["/a.sog", "/b.sog"] });
    render(<PlannerScene />);

    await waitFor(() => {
      expect(useCockpitStore.getState().roomResolve).toEqual({
        phase: "developing",
        loadedChunks: 0,
        totalChunks: 2,
      });
    });
  });
});
