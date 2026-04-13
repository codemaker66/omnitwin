/**
 * @aspirational Scene state schemas — model the client-side view state
 * (camera, selected objects, view mode). These types are tested and exported
 * but not yet consumed by the web package's Zustand stores. When a unified
 * scene-state store is implemented, import from here.
 */
import { z } from "zod";
import { SpaceIdSchema } from "./space.js";
import { Vec3Schema, PlacedObjectIdSchema, ConfigurationIdSchema } from "./configuration.js";

// ---------------------------------------------------------------------------
// View Mode — what the user is currently looking at
// ---------------------------------------------------------------------------

export const VIEW_MODES = ["blueprint-2d", "room-3d"] as const;

export const ViewModeSchema = z.enum(VIEW_MODES);

export type ViewMode = z.infer<typeof ViewModeSchema>;

// ---------------------------------------------------------------------------
// Camera State — position, target, and FOV for the 3D camera
// ---------------------------------------------------------------------------

const MIN_FOV = 10;
const MAX_FOV = 120;

export const CameraStateSchema = z.object({
  position: Vec3Schema,
  target: Vec3Schema,
  fov: z
    .number()
    .finite("FOV must be finite")
    .min(MIN_FOV, `FOV must be at least ${String(MIN_FOV)} degrees`)
    .max(MAX_FOV, `FOV must be at most ${String(MAX_FOV)} degrees`),
});

export type CameraState = z.infer<typeof CameraStateSchema>;

// ---------------------------------------------------------------------------
// Transition State — tracks the cinematic fly-in animation
// ---------------------------------------------------------------------------

export const TRANSITION_STATES = ["idle", "flying-in", "flying-out"] as const;

export const TransitionStateSchema = z.enum(TRANSITION_STATES);

export type TransitionState = z.infer<typeof TransitionStateSchema>;

// ---------------------------------------------------------------------------
// Scene State — the full client-side view state for Zustand
// ---------------------------------------------------------------------------

export const SceneStateSchema = z.object({
  viewMode: ViewModeSchema,
  camera: CameraStateSchema,
  transition: TransitionStateSchema,
  selectedSpaceId: SpaceIdSchema.nullable(),
  selectedObjectId: PlacedObjectIdSchema.nullable(),
  activeConfigurationId: ConfigurationIdSchema.nullable(),
  minimapVisible: z.boolean(),
});

export type SceneState = z.infer<typeof SceneStateSchema>;
