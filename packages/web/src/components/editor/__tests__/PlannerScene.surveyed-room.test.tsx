vi.mock("../../scene/NativeCanvas.js", async () => ({ NativeCanvas: (await import("@react-three/fiber")).Canvas }));
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SpaceSchema, type SpaceDimensions } from "@omnitwin/types";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { PerspectiveCamera, Scene } from "three";
import { encodeReliefFile, flatCeilingEntry, flatWallEntry } from "../../surveyed-room/__tests__/fixtures/relief-file.js";
import type { SurveyedRoom } from "../../surveyed-room/use-surveyed-room.js";

// The planner's scene with a surveyed room mounted in it (T-662), in the manner
// of PlannerScene.test.tsx: the Canvas is stood in for by a host that keeps the
// scene's elements unmounted, so what the scene chooses to draw can be read.

type CanvasMockProps = Readonly<{ children?: ReactNode }>;
const canvasChildren = vi.hoisted(() => ({ current: null as ReactNode }));
const three = vi.hoisted(() => ({
  gl: { compileAsync: vi.fn(() => Promise.resolve()) },
  scene: null as Scene | null,
  camera: null as PerspectiveCamera | null,
  invalidate: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: typeof three) => unknown) => selector(three),
  useFrame: () => undefined,
  addAfterEffect: () => () => undefined,
  Canvas: ({ children }: CanvasMockProps) => {
    canvasChildren.current = children;
    return <div data-testid="r3f-canvas" />;
  },
}));
vi.mock("../CockpitSplatLayer.js", () => ({ CockpitSplatLayer: () => null }));
vi.mock("../../../hooks/use-room-runtime-splat.js", () => ({
  useRoomRuntimeSplat: () => ({
    splatUrls: [], environmentUrls: [], transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, note: "identity" },
    hasAsset: false, status: "none", roomSlug: null, source: "none",
  }),
}));
vi.mock("../../../hooks/use-chunk-arrivals.js", () => ({
  useChunkArrivals: () => ({ loadedCount: 0, failedCount: 0, loadedUrls: new Set<string>(), failedUrls: new Set<string>(), markLoaded: vi.fn(), markFailed: vi.fn() }),
}));
// Whether the space's venue is Trades Hall is read from the API; here it is set.
const venue = vi.hoisted(() => ({ tradesHall: true as boolean | null }));
vi.mock("../../../hooks/use-trades-hall-venue.js", () => ({
  useTradesHallVenue: () => venue.tradesHall,
  isTradesHallVenueSlug: (slug: string) => slug === "trades-hall" || slug === "trades-hall-glasgow",
}));

const { PlannerScene } = await import("../PlannerScene.js");
const { useCockpitStore } = await import("../../../stores/cockpit-store.js");
const { useEditorStore } = await import("../../../stores/editor-store.js");
const { useLayoutTimelinePreviewStore } = await import("../../../stores/layout-timeline-preview-store.js");
const { useSurveyedRoomStore } = await import("../../../stores/surveyed-room-store.js");
const { surveyedRoomCaption } = await import("../../surveyed-room/room-status.js");
const { resolveRoomGeometry } = await import("../../../data/room-geometries.js");
const { computeCameraTarget, computeDefaultCameraPosition } = await import("../../../lib/camera-rig.js");
const { surveyedRoomOpeningPose } = await import("../../surveyed-room/room-opening-view.js");
const { HALL_VIEW_POSES } = await import("../../grand-hall/HallViewDirector.js");

function sceneElements(children: ReactNode = canvasChildren.current): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...sceneElements((child.props.children ?? null) as ReactNode)];
  });
}
function sceneComponent(name: string): ReactElement<Record<string, unknown>> | undefined {
  return sceneElements().find((child) => typeof child.type === "function" && child.type.name === name);
}
/** An intrinsic element of the scene by what it attaches as ("background", "fog"). */
function attached(what: string): ReactElement<Record<string, unknown>> | undefined {
  return sceneElements().find((child) => child.props.attach === what);
}

const FOLDER = "/rooms/saloon/survey-2026-07-11";
const STAGED = `?rooms=surveyed&roomsBase=${FOLDER}&roomsRev=1`;
const FIXTURE_TEXT = readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8");

interface RawSaloon {
  walls: { reliefId: string; length: number; height: number }[];
  ceiling: { extent: { x: [number, number]; z: [number, number] } };
  files: Record<string, { bytes: number; sha256: string }>;
}
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Serves the Saloon's survey from its folder; `missing` names a file the server does not have. */
function serveSaloon(missing: string | null = null): Mock<FetchFn> {
  const record = JSON.parse(FIXTURE_TEXT) as RawSaloon;
  const walls = encodeReliefFile(record.walls.map((wall) => flatWallEntry(wall.reliefId, wall.length, wall.height)));
  const ceiling = encodeReliefFile([flatCeilingEntry("ceiling", record.ceiling.extent.x, record.ceiling.extent.z)]);
  const zero = "0".repeat(64);
  record.files["walls-relief.bin"] = { bytes: walls.byteLength, sha256: zero };
  record.files["ceiling-relief.bin"] = { bytes: ceiling.byteLength, sha256: zero };
  const bodies: Readonly<Record<string, () => BodyInit>> = {
    "survey.json": () => JSON.stringify(record), "walls-relief.bin": () => walls.slice(0), "ceiling-relief.bin": () => ceiling.slice(0),
  };
  const fake = vi.fn<FetchFn>((input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const name = url.split("?")[0]?.split("/").pop() ?? "";
    const body = name === missing ? undefined : bodies[name];
    return Promise.resolve(body === undefined ? new Response("not found", { status: 404 }) : new Response(body(), { status: 200 }));
  });
  vi.stubGlobal("fetch", fake);
  return fake;
}

function chooseRoom(name: string, slug: string): void {
  const id = "00000000-0000-4000-8000-000000000662";
  useEditorStore.setState({ configId: id, space: SpaceSchema.parse({
    id, venueId: "00000000-0000-4000-8000-000000000099", name, slug,
    description: null, widthM: "12", lengthM: "7", heightM: "5.4",
    floorPlanOutline: [{ x: -6, y: -3.5 }, { x: 6, y: -3.5 }, { x: 6, y: 3.5 }, { x: -6, y: 3.5 }],
    meshUrl: null, thumbnailUrl: null, sortOrder: 3,
    createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
  }) });
}

function openPlanner(search: string): void {
  window.history.replaceState(null, "", `/plan${search}`);
}

/** What of the scene a room's drawing may change, read together. */
function drawing(): Record<string, unknown> {
  return {
    shell: sceneComponent("RoomMesh") !== undefined,
    surveyed: sceneComponent("SurveyedRoomModel") !== undefined,
    hall: sceneComponent("GrandHallModel") !== undefined,
    ink: sceneComponent("InkArchitectureLayer") !== undefined,
    background: (attached("background")?.props.args as readonly string[] | undefined)?.[0],
    fog: attached("fog") !== undefined,
    photographedRoom: sceneComponent("CaptureToneMapping")?.props.photographedRoom,
    lighting: sceneComponent("RoomLighting")?.props.variant,
  };
}

/** The plain shell, as every room but the Grand Hall is drawn today. */
const PLAIN_SHELL = {
  shell: true, surveyed: false, hall: false, ink: true, background: "#eee9de", fog: true, photographedRoom: false, lighting: "polygon",
};

beforeEach(() => {
  three.scene = new Scene();
  three.camera = new PerspectiveCamera();
  useCockpitStore.getState().reset();
  useEditorStore.setState({ space: null, configId: null });
  useLayoutTimelinePreviewStore.getState().clear();
  venue.tradesHall = true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  window.localStorage.removeItem("venviewer.surveyed-rooms");
});

describe("PlannerScene with a surveyed room", () => {
  it("draws the plain shell exactly as today where the device has not turned the switch on, and asks for nothing", () => {
    const fake = serveSaloon();
    openPlanner(`?roomsBase=${FOLDER}&roomsRev=1`);
    chooseRoom("Saloon", "saloon");
    render(<PlannerScene />);
    expect(drawing()).toEqual(PLAIN_SHELL);
    expect(sceneComponent("RoomMesh")?.props).toEqual({ geometry: resolveRoomGeometry({ name: "Saloon", heightM: "5.4", floorPlanOutline: [] }), variant: "generic", includeLighting: false });
    expect(String(sceneComponent("PlannerScenePrecompiler")?.props.signature)).toContain(":generic:");
    // And opens on the planner's own view of it: no pose of the room's own.
    expect(sceneComponent("CameraRig")?.props.defaultPose).toBeNull();
    expect(fake).not.toHaveBeenCalled();
    expect(useSurveyedRoomStore.getState().status).toBeNull();
  });

  it("draws the plain shell where the switch is on and the room has no survey", () => {
    const fake = serveSaloon();
    openPlanner("?rooms=surveyed");
    chooseRoom("Saloon", "saloon");
    render(<PlannerScene />);
    expect(drawing()).toEqual(PLAIN_SHELL);
    expect(fake).not.toHaveBeenCalled();
    expect(useSurveyedRoomStore.getState().status).toBeNull();
  });

  it("keeps the shell while the survey loads, then draws the surveyed room in its place", async () => {
    serveSaloon();
    openPlanner(STAGED);
    chooseRoom("Saloon", "saloon");
    render(<PlannerScene />);
    // The room resolves: it never blanks. The shell stands, on parchment, and the planner is told a survey is loading.
    expect(drawing()).toEqual(PLAIN_SHELL);
    expect(surveyedRoomCaption(useSurveyedRoomStore.getState().status)).toMatch(/^Loading the Saloon as surveyed/);
    const placement = sceneComponent("PlannerInteractionFloor")?.props;
    const rig = sceneComponent("CameraRig")?.props as { dimensions: SpaceDimensions; defaultPose: unknown } | undefined;
    // While the shell stands the camera opens as on any plain room.
    expect(rig?.defaultPose).toBeNull();

    await waitFor(() => { expect(sceneComponent("SurveyedRoomModel")).toBeDefined(); });
    // The photographs stand as the Grand Hall's do: a dark surround, no fog, their own camera response; no blueprint
    // ink over them. The furniture keeps the planner's rig.
    expect(drawing()).toEqual({
      shell: false, surveyed: true, hall: false, ink: false, background: "#120e0b", fog: false, photographedRoom: true, lighting: "polygon",
    });
    const model = sceneComponent("SurveyedRoomModel")?.props as { room: SurveyedRoom; onPhotoProgress: unknown } | undefined;
    expect(model?.room.record.slug).toBe("saloon");
    expect(model?.room.entry).toEqual({ slug: "saloon", base: FOLDER, revision: 1 });
    expect(String(sceneComponent("PlannerScenePrecompiler")?.props.signature)).toContain(":surveyed:");
    // Placement, bounds and the camera's limits come from the room's data, not from how it is drawn.
    expect(sceneComponent("PlannerInteractionFloor")?.props).toEqual(placement);
    expect(sceneComponent("CameraRig")?.props.dimensions).toBe(rig?.dimensions);
    // Its opening view alone follows the survey: the planner's own way of looking at the room, from as far back
    // as holds the room as surveyed (room-opening-view.ts), handed to the rig as the Grand Hall's own pose is.
    const drawn = model?.room.geometry;
    const data = rig?.dimensions;
    if (drawn === undefined || data === undefined) throw new Error("the scene has no surveyed room or no camera rig");
    const opening = sceneComponent("CameraRig")?.props.defaultPose as { position: readonly number[]; target: readonly number[] } | null | undefined;
    expect(opening).toEqual(surveyedRoomOpeningPose(drawn, data, 55));
    expect(opening?.target).toEqual(computeCameraTarget(data, 16 / 9));
    // From well above the planner's own 12 m, where the room's walls ran off the frame.
    expect(opening?.position[1]).toBeGreaterThan(computeDefaultCameraPosition(data, 16 / 9)[1] + 5);
    expect(useCockpitStore.getState().sceneSource?.proceduralGeometryVisible).toBe(true);

    // The drawn room's photograph reports reach the planner's caption.
    const report = model?.onPhotoProgress as (progress: { expected: number; settled: number; failed: string[] }) => void;
    act(() => { report({ expected: 3, settled: 1, failed: [] }); });
    expect(surveyedRoomCaption(useSurveyedRoomStore.getState().status)).toBe("Loading the Saloon's photographs · 1 of 3");
    act(() => { report({ expected: 3, settled: 3, failed: [] }); });
    expect(surveyedRoomCaption(useSurveyedRoomStore.getState().status)).toBeNull();
    // The pose is the same object through those renders: a new one would open the camera afresh (CameraRig).
    expect(sceneComponent("CameraRig")?.props.defaultPose).toBe(opening);
  });

  it("keeps the shell and says so when the survey cannot be loaded", async () => {
    serveSaloon("ceiling-relief.bin");
    openPlanner(STAGED);
    chooseRoom("Saloon", "saloon");
    render(<PlannerScene />);
    await waitFor(() => { expect(useSurveyedRoomStore.getState().status?.phase).toBe("failed"); });
    expect(drawing()).toEqual(PLAIN_SHELL);
    expect(surveyedRoomCaption(useSurveyedRoomStore.getState().status)).toBe("The surveyed Saloon could not load, so the room is drawn plainly. Planning is unaffected.");
    expect(useSurveyedRoomStore.getState().status?.failure).toMatch(/^ceiling-relief\.bin \(http\)/);
    // The shell is what is drawn, so the camera opens as on any plain room.
    expect(sceneComponent("CameraRig")?.props.defaultPose).toBeNull();
  });

  it("never draws Trades Hall's surveyed room for another venue's room of the same slug", async () => {
    venue.tradesHall = false;
    const fake = serveSaloon();
    openPlanner(STAGED);
    chooseRoom("Saloon", "saloon");
    render(<PlannerScene />);
    await act(async () => { await Promise.resolve(); });
    expect(drawing()).toEqual(PLAIN_SHELL);
    expect(fake).not.toHaveBeenCalled();
    expect(useSurveyedRoomStore.getState().status).toBeNull();
  });

  it("ignores a staged folder in a production build", async () => {
    vi.stubEnv("DEV", false);
    const fake = serveSaloon();
    openPlanner(STAGED);
    chooseRoom("Saloon", "saloon");
    render(<PlannerScene />);
    await act(async () => { await Promise.resolve(); });
    expect(drawing()).toEqual(PLAIN_SHELL);
    expect(fake).not.toHaveBeenCalled();
  });

  it("leaves the Grand Hall to its own model, whatever the switch and the address say", async () => {
    const fake = serveSaloon();
    openPlanner(STAGED);
    chooseRoom("Grand Hall", "grand-hall");
    render(<PlannerScene />);
    await act(async () => { await Promise.resolve(); });
    expect(drawing()).toMatchObject({ shell: false, surveyed: false, hall: true, ink: false, background: "#120e0b", fog: false, photographedRoom: true });
    expect(sceneComponent("CameraRig")?.props.defaultPose).toBe(HALL_VIEW_POSES.room);
    expect(fake).not.toHaveBeenCalled();
    expect(useSurveyedRoomStore.getState().status).toBeNull();
  });

  it("puts the surveyed room away with the model view: under a history preview nothing of it is drawn", async () => {
    serveSaloon();
    openPlanner(STAGED);
    chooseRoom("Saloon", "saloon");
    render(<PlannerScene />);
    await waitFor(() => { expect(sceneComponent("SurveyedRoomModel")).toBeDefined(); });
    act(() => { useLayoutTimelinePreviewStore.getState().showScheduleGap("Room flip"); });
    expect(drawing()).toMatchObject({ shell: false, surveyed: false, background: "#eee9de", photographedRoom: false });
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    expect(drawing()).toMatchObject({ surveyed: true, background: "#120e0b", photographedRoom: true });
  });
});
