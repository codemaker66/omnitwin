import { z } from "zod";
import type { EventInstructions, GuestEnquiry } from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Response schemas — Zod validation at the API boundary
//
// Every response from the configurations API is now validated through a Zod
// schema before reaching application code. This catches contract drift (a
// renamed field, a missing column, a number where a string was expected)
// at the network boundary instead of deep in component code.
//
// Request types (BatchObjectInput, GuestEnquiryInput) remain plain interfaces
// because they are outbound payloads composed by application code, not parsed
// from untrusted JSON.
// ---------------------------------------------------------------------------

/**
 * Object metadata blob — JSON column on placed_objects.
 *
 * Used to round-trip scene-only state (cloth drape, group membership)
 * that doesn't have first-class columns. Forward-compatible: future
 * fields can be added here without DB migrations.
 */
export interface ObjectMetadata {
  readonly clothed?: boolean;
  readonly groupId?: string | null;
  /** Planner-authored note surfaced on the hallkeeper sheet. */
  readonly notes?: string;
}

const ObjectMetadataResponseSchema = z.object({
  clothed: z.boolean().optional(),
  groupId: z.string().nullable().optional(),
  notes: z.string().optional(),
}).nullable();

const PlacedObjectResponseSchema = z.object({
  id: z.string(),
  configurationId: z.string(),
  assetDefinitionId: z.string(),
  positionX: z.string(),
  positionY: z.string(),
  positionZ: z.string(),
  rotationX: z.string(),
  rotationY: z.string(),
  rotationZ: z.string(),
  scale: z.string(),
  sortOrder: z.number(),
  metadata: ObjectMetadataResponseSchema,
});

export type PlacedObject = z.infer<typeof PlacedObjectResponseSchema>;

const ConfigurationResponseSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  venueId: z.string(),
  userId: z.string().nullable(),
  name: z.string(),
  isPublicPreview: z.boolean(),
  objects: z.array(PlacedObjectResponseSchema).optional(),
});

export type Configuration = z.infer<typeof ConfigurationResponseSchema>;

const PlacedObjectArraySchema = z.array(PlacedObjectResponseSchema);

const GuestEnquiryResponseSchema = z.object({
  enquiryId: z.string(),
  message: z.string(),
});

export type GuestEnquiryResponse = z.infer<typeof GuestEnquiryResponseSchema>;

// ---------------------------------------------------------------------------
// Request types (outbound payloads — not schema-validated)
// ---------------------------------------------------------------------------

export interface BatchObjectInput {
  readonly id?: string;
  readonly assetDefinitionId: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
  readonly scale: number;
  readonly sortOrder: number;
  readonly metadata?: ObjectMetadata | null;
}

/** Re-export the canonical guest enquiry input type from @omnitwin/types. */
export type GuestEnquiryInput = GuestEnquiry;

// ---------------------------------------------------------------------------
// Public endpoints (no auth)
// ---------------------------------------------------------------------------

export async function createPublicConfig(spaceId: string, name?: string): Promise<Configuration> {
  return api.post("/public/configurations", { spaceId, name }, true, ConfigurationResponseSchema);
}

export async function publicBatchSave(configId: string, objects: readonly BatchObjectInput[]): Promise<PlacedObject[]> {
  return api.post(`/public/configurations/${configId}/objects/batch`, { objects }, true, PlacedObjectArraySchema);
}

export async function getPublicConfig(configId: string): Promise<Configuration> {
  return api.get(`/public/configurations/${configId}`, ConfigurationResponseSchema);
}

/**
 * Set the floor plan thumbnail on a public preview config.
 * Accepts a PNG data URL from the orthographic capture.
 */
export async function updatePublicThumbnail(configId: string, thumbnailUrl: string): Promise<Configuration> {
  return api.post(`/public/configurations/${configId}/thumbnail`, { thumbnailUrl }, true, ConfigurationResponseSchema);
}

// ---------------------------------------------------------------------------
// Authenticated endpoints
// ---------------------------------------------------------------------------

export async function getConfig(configId: string): Promise<Configuration> {
  return api.get(`/configurations/${configId}`, ConfigurationResponseSchema);
}

export async function claimConfig(configId: string): Promise<Configuration> {
  return api.post(`/configurations/${configId}/claim`, undefined, undefined, ConfigurationResponseSchema);
}

export async function authBatchSave(configId: string, objects: readonly BatchObjectInput[]): Promise<PlacedObject[]> {
  return api.post(`/configurations/${configId}/objects/batch`, { objects }, undefined, PlacedObjectArraySchema);
}

// ---------------------------------------------------------------------------
// Event-level instructions — configurations.metadata.instructions
//
// The planner's human layer: special instructions, day-of contact, per-
// phase deadlines, access notes. Persists to the configurations.metadata
// JSONB column via the auth PATCH endpoint. Pass null to clear.
// ---------------------------------------------------------------------------

export interface ConfigMetadataInput {
  readonly instructions?: EventInstructions | null;
}

const PatchConfigResponseSchema = z.object({ id: z.string() }).passthrough();

export async function patchConfigMetadata(
  configId: string,
  metadata: ConfigMetadataInput | null,
): Promise<unknown> {
  return api.patch(`/configurations/${configId}`, { metadata }, PatchConfigResponseSchema);
}

// ---------------------------------------------------------------------------
// Guest enquiry
// ---------------------------------------------------------------------------

export async function submitGuestEnquiry(input: GuestEnquiryInput): Promise<GuestEnquiryResponse> {
  return api.post("/public/enquiries", input, true, GuestEnquiryResponseSchema);
}
