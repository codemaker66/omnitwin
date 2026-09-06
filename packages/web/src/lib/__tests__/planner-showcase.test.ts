import { beforeEach, describe, expect, it } from "vitest";
import { roomSplatBundle, walkPoseForBundle } from "../../data/room-splat-bundles.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { advanceCameraTour, buildShowcaseTour, sampleCameraTour } from "../camera-tour.js";
import { GRAND_HALL_ARRIVAL } from "../planner-room-arrival.js";
import { buildPlannerShowcaseTour, finishPlannerShowcaseTour, plannerShowcaseStillCurrent } from "../planner-showcase.js";
import type { PlannerSceneSourceEvidence } from "../truth-mode-summary.js";

const dimensions = { width: 21, length: 10.5, height: 7 };
const source: PlannerSceneSourceEvidence = {
  configId: "demo", spaceId: "hall", layerMode: "splat", captureSource: "staged",
  loadedChunks: 12, totalChunks: 12, proceduralGeometryVisible: false,
};
const input = { dimensions, roomSlug: "grand-hall", configId: "demo", spaceId: "hall", layerMode: "splat" as const, sceneSource: source };
const space = { id: "hall", venueId: "venue", slug: "grand-hall", name: "Grand Hall",
  widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [] };

beforeEach(() => {
  useCockpitStore.getState().reset();
  useEditorStore.getState().reset();
  useBookmarkStore.setState({ tour: null, transition: null, pendingNavigationId: null, activeReferenceId: null });
});

describe("planner Showcase source frame", () => {
  it("reproduces the generic path outside the actual GH2 walk envelope", () => {
    const bundle = roomSplatBundle("grand-hall");
    if (bundle === null || bundle.bounds === null) throw new Error("Missing actual GH2 descriptor");
    const generic = buildShowcaseTour(dimensions);
    expect(sampleCameraTour(advanceCameraTour(generic, generic.totalSec)).position[0]).toBeGreaterThan(bundle.bounds.max[0]);
    expect(sampleCameraTour(generic).position[1]).toBeGreaterThan(bundle.extentM[1]);
  });

  it("uses served Z-axis interior poses and returns to the qualified arrival", () => {
    const tour = buildPlannerShowcaseTour(input);
    const bundle = roomSplatBundle("grand-hall");
    const walk = bundle === null ? null : walkPoseForBundle(bundle);
    if (tour === null || walk === null) throw new Error("Missing captured tour");
    expect(tour.interiorOwner).toEqual({ configId: "demo", spaceId: "hall", roomSlug: "grand-hall" });
    expect(sampleCameraTour(tour).position).toEqual(GRAND_HALL_ARRIVAL.position);
    expect(sampleCameraTour(advanceCameraTour(tour, tour.totalSec)).position).toEqual(GRAND_HALL_ARRIVAL.position);
    const positions = [];
    for (let elapsed = 0; elapsed <= tour.totalSec; elapsed += 0.025) {
      const sample = sampleCameraTour(advanceCameraTour(tour, elapsed));
      positions.push(sample.position);
      for (const axis of [0, 1, 2] as const) {
        expect(sample.position[axis]).toBeGreaterThanOrEqual(walk.bounds.min[axis]);
        expect(sample.position[axis]).toBeLessThanOrEqual(walk.bounds.max[axis]);
      }
      expect(sample.position[0]).toBeCloseTo(GRAND_HALL_ARRIVAL.position[0], 10);
      expect(sample.target[1]).toBeGreaterThan(sample.position[1]);
    }
    expect(Math.min(...positions.map((position) => position[2]))).toBeLessThan(3);
  });

  it("preserves the Model/fallback tour and refuses another capture's frame", () => {
    expect(buildPlannerShowcaseTour({ ...input, layerMode: "mesh" })).toEqual(buildShowcaseTour(dimensions));
    expect(buildPlannerShowcaseTour({ ...input, sceneSource: { ...source, captureSource: "none" } })).toEqual(buildShowcaseTour(dimensions));
    expect(buildPlannerShowcaseTour({ ...input, sceneSource: { ...source, captureSource: "package" } })).toBeNull();
    expect(buildPlannerShowcaseTour({ ...input, sceneSource: { ...source, configId: "old" } })).toBeNull();
    expect(buildPlannerShowcaseTour({ ...input, sceneSource: null })).toBeNull();
    expect(buildPlannerShowcaseTour({ ...input, roomSlug: "reception-room" })).toBeNull();
  });

  it("ignores tile progress identity while retaining the exact capture owner", () => {
    const tour = buildPlannerShowcaseTour(input);
    if (tour === null) throw new Error("Missing tour");
    useEditorStore.setState({ configId: "demo", space });
    useCockpitStore.setState({ sceneSource: { ...source, loadedChunks: 1 }, layerMode: "splat" });
    expect(plannerShowcaseStillCurrent(tour)).toBe(true);
    useCockpitStore.setState({ sceneSource: { ...source, loadedChunks: 12 } });
    expect(plannerShowcaseStillCurrent(tour)).toBe(true);
    useCockpitStore.setState({ layerMode: "mesh" });
    expect(plannerShowcaseStillCurrent(tour)).toBe(false);
  });

  it("completion and Escape return to Interior only for the current tour/source", () => {
    const tour = buildPlannerShowcaseTour(input);
    if (tour === null) throw new Error("Missing tour");
    useEditorStore.setState({ configId: "demo", space });
    useCockpitStore.setState({ sceneSource: source, layerMode: "splat" });
    useBookmarkStore.getState().startTour(tour);
    finishPlannerShowcaseTour(tour);
    expect(useBookmarkStore.getState().tour).toBeNull();
    expect(useCockpitStore.getState().walkMode).toBe(true);
    useCockpitStore.setState({ walkMode: false });
    const next = buildShowcaseTour(dimensions);
    useBookmarkStore.getState().startTour(next);
    finishPlannerShowcaseTour(tour);
    expect(useBookmarkStore.getState().tour).toBe(next);
    expect(useCockpitStore.getState().walkMode).toBe(false);
    finishPlannerShowcaseTour(next);
    expect(useCockpitStore.getState().walkMode).toBe(false);
    useBookmarkStore.getState().startTour(tour);
    useCockpitStore.setState({ sceneSource: { ...source, captureSource: "none" } });
    finishPlannerShowcaseTour(tour);
    expect(useBookmarkStore.getState().tour).toBeNull();
    expect(useCockpitStore.getState().walkMode).toBe(false);
  });
});
