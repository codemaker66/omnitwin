import { z } from "zod";
import { ConfigurationReviewStatusSchema, type EventInstructions, type GuestEnquiry } from "@omnitwin/types";
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
  readonly clothStyle?: "black" | "white" | null;
  readonly tableSetting?: "dinner" | null;
  /** DRESSING (C2): chair style dressed around this table. */
  readonly chairStyle?: string | null;
  /** DRESSING (C2): the centrepiece on this table. */
  readonly centerpiece?: string | null;
  readonly groupId?: string | null;
  /** Hallkeeper-visible seat/table label rendered in the planner. */
  readonly displayLabel?: string;
  /** Planner-authored note surfaced on the hallkeeper sheet. */
  readonly notes?: string;
}

export const ObjectMetadataResponseSchema = z.object({
  clothed: z.boolean().optional(),
  clothStyle: z.enum(["black", "white"]).nullable().optional(),
  tableSetting: z.enum(["dinner"]).nullable().optional(),
  chairStyle: z.string().nullable().optional(),
  centerpiece: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  displayLabel: z.string().optional(),
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
  revision: z.number().int().min(1),
  // Keep the server timestamp for saved-state display after a clean reopen.
  // Older responses may omit it; never substitute the browser's load time.
  updatedAt: z.iso.datetime({ offset: true }).optional(),
  objects: z.array(PlacedObjectResponseSchema).optional(),
  // Event-level metadata (special instructions, day-of contact, phase
  // deadlines, access notes). Absent on legacy rows, null on cleared rows,
  // an object on populated rows. Typed as unknown so Zod preserves the
  // JSONB without stripping keys — the strong schema lives in
  // @omnitwin/types.ConfigurationMetadataSchema and is applied at the
  // component boundary that actually reads the fields. Without this
  // field, Zod's default object mode strips metadata entirely and the
  // Event Details panel loads blank on every reopen.
  metadata: z.unknown().optional(),
  // The review workflow's state (authenticated reads return the whole row).
  // A value this client does not know reads as absent rather than failing
  // the layout's load: the editor only needs to know when edits are refused.
  reviewStatus: ConfigurationReviewStatusSchema.optional().catch(undefined),
  // One of the venue's sample layouts (the row's is_template). Optional, and
  // anything but a boolean reads as absent: a label never fails a load.
  isTemplate: z.boolean().optional().catch(undefined),
});

export type Configuration = z.infer<typeof ConfigurationResponseSchema>;

// A new public plan comes back with the secret that lets this browser, and
// only this browser, claim it into an account later (migration 0102). An API
// from before 0102 sends none, and the plan then stays a public draft.
const CreatedPublicConfigurationSchema = ConfigurationResponseSchema.extend({
  claimSecret: z.string().min(16).optional(),
});

export type CreatedPublicConfiguration = z.infer<typeof CreatedPublicConfigurationSchema>;

const PlacedObjectArraySchema = z.array(PlacedObjectResponseSchema);

const BatchSaveResponseSchema = z.object({
  objects: PlacedObjectArraySchema,
  revision: z.number().int().min(1),
});

export type BatchSaveResponse = z.infer<typeof BatchSaveResponseSchema>;

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

export async function createPublicConfig(spaceId: string, name?: string): Promise<CreatedPublicConfiguration> {
  return api.post("/public/configurations", { spaceId, name }, true, CreatedPublicConfigurationSchema);
}

/** How a batch save travels: `keepalive` lets one sent as the page hides or
 *  closes finish after the page has gone, when its body is small enough. */
export interface BatchSaveTransport {
  readonly keepalive?: boolean;
}

export async function publicBatchSave(
  configId: string,
  objects: readonly BatchObjectInput[],
  expectedRevision: number,
  transport?: BatchSaveTransport,
): Promise<BatchSaveResponse> {
  return api.post(
    `/public/configurations/${configId}/objects/batch`,
    { expectedRevision, objects },
    true,
    BatchSaveResponseSchema,
    transport?.keepalive === true ? { keepalive: true } : undefined,
  );
}

export async function getPublicConfig(configId: string, signal?: AbortSignal): Promise<Configuration> {
  return api.get(`/public/configurations/${configId}`, ConfigurationResponseSchema, signal);
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

const ConfigurationSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  spaceId: z.string(),
  venueId: z.string(),
});

export type ConfigurationSummary = z.infer<typeof ConfigurationSummarySchema>;

/** Name and room of up to 100 layouts in one request. Layouts the caller may
 *  not open, or that no longer exist, are absent from the result. */
export async function getConfigSummaries(configIds: readonly string[]): Promise<ConfigurationSummary[]> {
  const ids = configIds.map((id) => encodeURIComponent(id)).join(",");
  return api.get(`/configurations/summaries?ids=${ids}`, z.array(ConfigurationSummarySchema));
}

/** Claims a public plan into the signed-in account with the secret its
 *  creating browser was given; lib/planner-claim.ts is the caller. */
export async function claimConfig(configId: string, claimSecret: string): Promise<Configuration> {
  return api.post(`/configurations/${configId}/claim`, { claimSecret }, undefined, ConfigurationResponseSchema);
}

export async function authBatchSave(
  configId: string,
  objects: readonly BatchObjectInput[],
  expectedRevision: number,
  transport?: BatchSaveTransport,
): Promise<BatchSaveResponse> {
  return api.post(
    `/configurations/${configId}/objects/batch`,
    { expectedRevision, objects },
    undefined,
    BatchSaveResponseSchema,
    transport?.keepalive === true ? { keepalive: true } : undefined,
  );
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

const PatchConfigResponseSchema = z.object({ id: z.string() }).loose();

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
