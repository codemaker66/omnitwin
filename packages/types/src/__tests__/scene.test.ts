import { describe, it, expect } from "vitest";
import {
  VIEW_MODES,
  ViewModeSchema,
  CameraStateSchema,
  TRANSITION_STATES,
  TransitionStateSchema,
  SceneStateSchema,
} from "../scene.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_SPACE_UUID = "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f";
const VALID_OBJECT_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_CONFIG_UUID = "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80";

const validCamera = {
  position: { x: 0, y: 15, z: 20 },
  target: { x: 0, y: 0, z: 0 },
  fov: 60,
};

const validSceneState = {
  viewMode: "blueprint-2d" as const,
  camera: validCamera,
  transition: "idle" as const,
  selectedSpaceId: null,
  selectedObjectId: null,
  activeConfigurationId: null,
  minimapVisible: true,
};

// ---------------------------------------------------------------------------
// ViewModeSchema
// ---------------------------------------------------------------------------

describe("ViewModeSchema", () => {
  it("accepts 'blueprint-2d'", () => {
    expect(ViewModeSchema.safeParse("blueprint-2d").success).toBe(true);
  });

  it("accepts 'room-3d'", () => {
    expect(ViewModeSchema.safeParse("room-3d").success).toBe(true);
  });

  it("has exactly 2 modes", () => {
    expect(VIEW_MODES).toHaveLength(2);
  });

  it("contains the expected modes", () => {
    expect(VIEW_MODES).toEqual(["blueprint-2d", "room-3d"]);
  });

  it("rejects 'Blueprint2D' (case sensitive)", () => {
    expect(ViewModeSchema.safeParse("Blueprint2D").success).toBe(false);
  });

  it("rejects '2d' (partial match)", () => {
    expect(ViewModeSchema.safeParse("2d").success).toBe(false);
  });

  it("rejects '3d' (partial match)", () => {
    expect(ViewModeSchema.safeParse("3d").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(ViewModeSchema.safeParse("").success).toBe(false);
  });

  it("rejects null", () => {
    expect(ViewModeSchema.safeParse(null).success).toBe(false);
  });

  it("rejects a number", () => {
    expect(ViewModeSchema.safeParse(0).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TransitionStateSchema
// ---------------------------------------------------------------------------

describe("TransitionStateSchema", () => {
  it.each(TRANSITION_STATES)("accepts '%s'", (state) => {
    expect(TransitionStateSchema.safeParse(state).success).toBe(true);
  });

  it("has exactly 3 transition states", () => {
    expect(TRANSITION_STATES).toHaveLength(3);
  });

  it("contains the expected states", () => {
    expect(TRANSITION_STATES).toEqual(["idle", "flying-in", "flying-out"]);
  });

  it("rejects 'Idle' (case sensitive)", () => {
    expect(TransitionStateSchema.safeParse("Idle").success).toBe(false);
  });

  it("rejects 'transitioning' (not a valid state)", () => {
    expect(TransitionStateSchema.safeParse("transitioning").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(TransitionStateSchema.safeParse("").success).toBe(false);
  });

  it("rejects null", () => {
    expect(TransitionStateSchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CameraStateSchema
// ---------------------------------------------------------------------------

describe("CameraStateSchema", () => {
  it("accepts a valid camera state", () => {
    const result = CameraStateSchema.safeParse(validCamera);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fov).toBe(60);
    }
  });

  it("accepts negative position values (camera behind origin)", () => {
    const result = CameraStateSchema.safeParse({
      ...validCamera,
      position: { x: -10, y: -5, z: -20 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts zero position (camera at origin)", () => {
    const result = CameraStateSchema.safeParse({
      ...validCamera,
      position: { x: 0, y: 0, z: 0 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts FOV of 10 (minimum)", () => {
    expect(CameraStateSchema.safeParse({ ...validCamera, fov: 10 }).success).toBe(true);
  });

  it("accepts FOV of 120 (maximum)", () => {
    expect(CameraStateSchema.safeParse({ ...validCamera, fov: 120 }).success).toBe(true);
  });

  it("accepts fractional FOV", () => {
    expect(CameraStateSchema.safeParse({ ...validCamera, fov: 45.5 }).success).toBe(true);
  });

  it("rejects FOV below 10", () => {
    expect(CameraStateSchema.safeParse({ ...validCamera, fov: 9 }).success).toBe(false);
  });

  it("rejects FOV of 0", () => {
    expect(CameraStateSchema.safeParse({ ...validCamera, fov: 0 }).success).toBe(false);
  });

  it("rejects negative FOV", () => {
    expect(CameraStateSchema.safeParse({ ...validCamera, fov: -30 }).success).toBe(false);
  });

  it("rejects FOV above 120", () => {
    expect(CameraStateSchema.safeParse({ ...validCamera, fov: 121 }).success).toBe(false);
  });

  it("rejects NaN FOV", () => {
    expect(CameraStateSchema.safeParse({ ...validCamera, fov: NaN }).success).toBe(false);
  });

  it("rejects Infinity FOV", () => {
    expect(CameraStateSchema.safeParse({ ...validCamera, fov: Infinity }).success).toBe(false);
  });

  it("rejects missing position", () => {
    const { position: _, ...noPosition } = validCamera;
    expect(CameraStateSchema.safeParse(noPosition).success).toBe(false);
  });

  it("rejects missing target", () => {
    const { target: _, ...noTarget } = validCamera;
    expect(CameraStateSchema.safeParse(noTarget).success).toBe(false);
  });

  it("rejects missing fov", () => {
    const { fov: _, ...noFov } = validCamera;
    expect(CameraStateSchema.safeParse(noFov).success).toBe(false);
  });

  it("rejects Infinity in position", () => {
    expect(
      CameraStateSchema.safeParse({
        ...validCamera,
        position: { x: Infinity, y: 0, z: 0 },
      }).success,
    ).toBe(false);
  });

  it("rejects NaN in target", () => {
    expect(
      CameraStateSchema.safeParse({
        ...validCamera,
        target: { x: 0, y: NaN, z: 0 },
      }).success,
    ).toBe(false);
  });

  it("rejects incomplete position (missing z)", () => {
    expect(
      CameraStateSchema.safeParse({
        ...validCamera,
        position: { x: 0, y: 0 },
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SceneStateSchema — full client-side view state
// ---------------------------------------------------------------------------

describe("SceneStateSchema", () => {
  it("accepts a fully valid initial scene state (all nulls)", () => {
    const result = SceneStateSchema.safeParse(validSceneState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.viewMode).toBe("blueprint-2d");
      expect(result.data.transition).toBe("idle");
      expect(result.data.selectedSpaceId).toBeNull();
      expect(result.data.selectedObjectId).toBeNull();
      expect(result.data.activeConfigurationId).toBeNull();
      expect(result.data.minimapVisible).toBe(true);
    }
  });

  it("accepts room-3d mode with selected space and configuration", () => {
    const result = SceneStateSchema.safeParse({
      ...validSceneState,
      viewMode: "room-3d",
      selectedSpaceId: VALID_SPACE_UUID,
      activeConfigurationId: VALID_CONFIG_UUID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.viewMode).toBe("room-3d");
      expect(result.data.selectedSpaceId).toBe(VALID_SPACE_UUID);
    }
  });

  it("accepts flying-in transition with selected space", () => {
    const result = SceneStateSchema.safeParse({
      ...validSceneState,
      transition: "flying-in",
      selectedSpaceId: VALID_SPACE_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("accepts flying-out transition", () => {
    const result = SceneStateSchema.safeParse({
      ...validSceneState,
      viewMode: "room-3d",
      transition: "flying-out",
      selectedSpaceId: VALID_SPACE_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("accepts selected object with valid UUID", () => {
    const result = SceneStateSchema.safeParse({
      ...validSceneState,
      viewMode: "room-3d",
      selectedSpaceId: VALID_SPACE_UUID,
      selectedObjectId: VALID_OBJECT_UUID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selectedObjectId).toBe(VALID_OBJECT_UUID);
    }
  });

  it("accepts minimapVisible false", () => {
    const result = SceneStateSchema.safeParse({ ...validSceneState, minimapVisible: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minimapVisible).toBe(false);
    }
  });

  // --- Missing required fields ---

  it("rejects missing viewMode", () => {
    const { viewMode: _, ...noViewMode } = validSceneState;
    expect(SceneStateSchema.safeParse(noViewMode).success).toBe(false);
  });

  it("rejects missing camera", () => {
    const { camera: _, ...noCamera } = validSceneState;
    expect(SceneStateSchema.safeParse(noCamera).success).toBe(false);
  });

  it("rejects missing transition", () => {
    const { transition: _, ...noTransition } = validSceneState;
    expect(SceneStateSchema.safeParse(noTransition).success).toBe(false);
  });

  it("rejects missing selectedSpaceId (required but nullable)", () => {
    const { selectedSpaceId: _, ...noSpaceId } = validSceneState;
    expect(SceneStateSchema.safeParse(noSpaceId).success).toBe(false);
  });

  it("rejects missing selectedObjectId (required but nullable)", () => {
    const { selectedObjectId: _, ...noObjectId } = validSceneState;
    expect(SceneStateSchema.safeParse(noObjectId).success).toBe(false);
  });

  it("rejects missing activeConfigurationId (required but nullable)", () => {
    const { activeConfigurationId: _, ...noConfigId } = validSceneState;
    expect(SceneStateSchema.safeParse(noConfigId).success).toBe(false);
  });

  it("rejects missing minimapVisible", () => {
    const { minimapVisible: _, ...noMinimap } = validSceneState;
    expect(SceneStateSchema.safeParse(noMinimap).success).toBe(false);
  });

  // --- Invalid field values ---

  it("rejects invalid viewMode", () => {
    expect(SceneStateSchema.safeParse({ ...validSceneState, viewMode: "overview" }).success).toBe(false);
  });

  it("rejects invalid transition", () => {
    expect(SceneStateSchema.safeParse({ ...validSceneState, transition: "zooming" }).success).toBe(false);
  });

  it("rejects invalid UUID for selectedSpaceId", () => {
    expect(SceneStateSchema.safeParse({ ...validSceneState, selectedSpaceId: "bad" }).success).toBe(false);
  });

  it("rejects invalid UUID for selectedObjectId", () => {
    expect(SceneStateSchema.safeParse({ ...validSceneState, selectedObjectId: "bad" }).success).toBe(false);
  });

  it("rejects invalid UUID for activeConfigurationId", () => {
    expect(SceneStateSchema.safeParse({ ...validSceneState, activeConfigurationId: "bad" }).success).toBe(false);
  });

  it("rejects string for minimapVisible (must be boolean)", () => {
    expect(SceneStateSchema.safeParse({ ...validSceneState, minimapVisible: "true" }).success).toBe(false);
  });

  it("rejects number for minimapVisible (must be boolean)", () => {
    expect(SceneStateSchema.safeParse({ ...validSceneState, minimapVisible: 1 }).success).toBe(false);
  });

  it("rejects invalid camera (bad FOV)", () => {
    expect(
      SceneStateSchema.safeParse({
        ...validSceneState,
        camera: { ...validCamera, fov: 200 },
      }).success,
    ).toBe(false);
  });

  it("rejects invalid camera (missing target)", () => {
    expect(
      SceneStateSchema.safeParse({
        ...validSceneState,
        camera: { position: { x: 0, y: 0, z: 0 }, fov: 60 },
      }).success,
    ).toBe(false);
  });
});
