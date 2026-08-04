import { afterEach, describe, expect, it } from "vitest";
import { useCockpitStore } from "../cockpit-store.js";

afterEach(() => { useCockpitStore.getState().reset(); });

describe("cockpit-store", () => {
  it("defaults to design lens, hybrid layer, all overlays on, no phase", () => {
    const s = useCockpitStore.getState();
    expect(s.activeMode).toBe("design");
    expect(s.layerMode).toBe("hybrid");
    expect(s.overlayVisibility.guestFlow).toBe(true);
    expect(s.selectedPhaseId).toBeNull();
  });

  it("setMode switches the active lens", () => {
    useCockpitStore.getState().setMode("flow");
    expect(useCockpitStore.getState().activeMode).toBe("flow");
  });

  it("setLayerMode switches the renderer layer", () => {
    useCockpitStore.getState().setLayerMode("splat");
    expect(useCockpitStore.getState().layerMode).toBe("splat");
  });

  it("toggleOverlay flips a single overlay without touching others", () => {
    useCockpitStore.getState().toggleOverlay("densityHeatmap");
    const v = useCockpitStore.getState().overlayVisibility;
    expect(v.densityHeatmap).toBe(false);
    expect(v.guestFlow).toBe(true);
  });

  it("selectPhase records the chosen phase id", () => {
    useCockpitStore.getState().selectPhase("dinner");
    expect(useCockpitStore.getState().selectedPhaseId).toBe("dinner");
  });

  it("defaults runtimeAssetStatus to the SAFE atelier fallback label and the layers menu closed", () => {
    const s = useCockpitStore.getState();
    expect(s.runtimeAssetStatus).toBe(
      "Captured visual layer not yet available — planning on reviewed geometry",
    );
    expect(s.layersOpen).toBe(false);
  });

  it("setRuntimeAssetStatus updates the runtime label", () => {
    useCockpitStore.getState().setRuntimeAssetStatus("Captured visual layer loaded / not yet signed");
    expect(useCockpitStore.getState().runtimeAssetStatus).toBe("Captured visual layer loaded / not yet signed");
  });

  it("defaults roomResolve to the ink phase with no chunks", () => {
    expect(useCockpitStore.getState().roomResolve).toEqual({
      phase: "ink",
      loadedChunks: 0,
      totalChunks: 0,
    });
  });

  it("setRoomResolve records the resolve choreography state", () => {
    useCockpitStore.getState().setRoomResolve({ phase: "developing", loadedChunks: 3, totalChunks: 7 });
    expect(useCockpitStore.getState().roomResolve).toEqual({
      phase: "developing",
      loadedChunks: 3,
      totalChunks: 7,
    });
  });

  it("toggleLayers flips the layers menu open state", () => {
    expect(useCockpitStore.getState().layersOpen).toBe(false);
    useCockpitStore.getState().toggleLayers();
    expect(useCockpitStore.getState().layersOpen).toBe(true);
  });

  it("defaults to no evidence beam and no camera focus request", () => {
    const s = useCockpitStore.getState();
    expect(s.beam).toBeNull();
    expect(s.focusRequest).toBeNull();
    expect(s.cameraInteractionActive).toBe(false);
  });

  it("setBeam / clearBeam raise and dismiss the world-anchored evidence beam", () => {
    useCockpitStore.getState().setBeam({
      anchor: [1, 0.05, -2],
      label: "Simulated route crossing — human review required",
      tone: "review",
    });
    expect(useCockpitStore.getState().beam?.tone).toBe("review");
    useCockpitStore.getState().clearBeam();
    expect(useCockpitStore.getState().beam).toBeNull();
  });

  it("requestFocus records the floor point and bumps the nonce each call", () => {
    useCockpitStore.getState().requestFocus(3, -4);
    const first = useCockpitStore.getState().focusRequest;
    expect(first).toEqual({ x: 3, z: -4, nonce: 1 });
    useCockpitStore.getState().requestFocus(3, -4);
    expect(useCockpitStore.getState().focusRequest?.nonce).toBe(2);
  });

  it("tracks whether camera navigation is currently active", () => {
    useCockpitStore.getState().setCameraInteractionActive(true);
    expect(useCockpitStore.getState().cameraInteractionActive).toBe(true);
    useCockpitStore.getState().setCameraInteractionActive(false);
    expect(useCockpitStore.getState().cameraInteractionActive).toBe(false);
  });

  it("reset restores defaults", () => {
    const api = useCockpitStore.getState();
    api.setMode("ops");
    api.setLayerMode("mesh");
    api.toggleOverlay("guestFlow");
    api.selectPhase("ceremony");
    api.setRuntimeAssetStatus("Captured visual layer loaded / not yet signed");
    api.setRoomResolve({ phase: "resolved", loadedChunks: 7, totalChunks: 7 });
    api.toggleLayers();
    api.setBeam({ anchor: [0, 0, 0], label: "x", tone: "info" });
    api.requestFocus(1, 1);
    api.setCameraInteractionActive(true);
    api.setPlannedGuestCount(200);
    api.setFlowArrivalMinutes(90);
    api.reset();
    const s = useCockpitStore.getState();
    expect(s.activeMode).toBe("design");
    expect(s.layerMode).toBe("hybrid");
    expect(s.overlayVisibility.guestFlow).toBe(true);
    expect(s.selectedPhaseId).toBeNull();
    expect(s.runtimeAssetStatus).toBe(
      "Captured visual layer not yet available — planning on reviewed geometry",
    );
    expect(s.roomResolve).toEqual({ phase: "ink", loadedChunks: 0, totalChunks: 0 });
    expect(s.layersOpen).toBe(false);
    expect(s.beam).toBeNull();
    expect(s.focusRequest).toBeNull();
    expect(s.cameraInteractionActive).toBe(false);
    expect(s.plannedGuestCount).toBeNull();
    expect(s.flowArrivalMinutes).toBe(30);
  });

  it("defaults plannedGuestCount to null and flowArrivalMinutes to 30", () => {
    const s = useCockpitStore.getState();
    expect(s.plannedGuestCount).toBeNull();
    expect(s.flowArrivalMinutes).toBe(30);
  });

  it("setPlannedGuestCount / setFlowArrivalMinutes update the Flow scenario", () => {
    useCockpitStore.getState().setPlannedGuestCount(120);
    expect(useCockpitStore.getState().plannedGuestCount).toBe(120);
    useCockpitStore.getState().setPlannedGuestCount(null);
    expect(useCockpitStore.getState().plannedGuestCount).toBeNull();
    useCockpitStore.getState().setFlowArrivalMinutes(45);
    expect(useCockpitStore.getState().flowArrivalMinutes).toBe(45);
  });
});
