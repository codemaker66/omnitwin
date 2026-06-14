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

  it("defaults runtimeAssetStatus to the SAFE procedural label and the layers menu closed", () => {
    const s = useCockpitStore.getState();
    expect(s.runtimeAssetStatus).toBe("Procedural layer / no signed capture");
    expect(s.layersOpen).toBe(false);
  });

  it("setRuntimeAssetStatus updates the runtime label", () => {
    useCockpitStore.getState().setRuntimeAssetStatus("Captured visual layer loaded / not yet signed");
    expect(useCockpitStore.getState().runtimeAssetStatus).toBe("Captured visual layer loaded / not yet signed");
  });

  it("toggleLayers flips the layers menu open state", () => {
    expect(useCockpitStore.getState().layersOpen).toBe(false);
    useCockpitStore.getState().toggleLayers();
    expect(useCockpitStore.getState().layersOpen).toBe(true);
  });

  it("reset restores defaults", () => {
    const api = useCockpitStore.getState();
    api.setMode("ops");
    api.setLayerMode("mesh");
    api.toggleOverlay("guestFlow");
    api.selectPhase("ceremony");
    api.setRuntimeAssetStatus("Captured visual layer loaded / not yet signed");
    api.toggleLayers();
    api.reset();
    const s = useCockpitStore.getState();
    expect(s.activeMode).toBe("design");
    expect(s.layerMode).toBe("hybrid");
    expect(s.overlayVisibility.guestFlow).toBe(true);
    expect(s.selectedPhaseId).toBeNull();
    expect(s.runtimeAssetStatus).toBe("Procedural layer / no signed capture");
    expect(s.layersOpen).toBe(false);
  });
});
