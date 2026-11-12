import { z } from "zod";
import { ReferenceLoadoutRowSchema, type ReferenceLoadoutRow } from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Response schemas — Zod validation at the API boundary.
//
// Every loadout response parsed from server JSON is validated through a Zod
// schema before reaching application code, so contract drift (a renamed
// field, a missing column, a string where a number was expected) fails loudly
// at the network boundary instead of crashing deep in dashboard components.
// ---------------------------------------------------------------------------

const LoadoutSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  photoCount: z.number(),
  coverFileKey: z.string().nullable(),
});

export type Loadout = z.infer<typeof LoadoutSchema>;

const LoadoutPhotoSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  caption: z.string().nullable(),
  sortOrder: z.number(),
  fileKey: z.string(),
  filename: z.string(),
  contentType: z.string(),
});

export type LoadoutPhoto = z.infer<typeof LoadoutPhotoSchema>;

const LoadoutDetailSchema = ReferenceLoadoutRowSchema.extend({
  photos: z.array(LoadoutPhotoSchema),
});

export type LoadoutDetail = z.infer<typeof LoadoutDetailSchema>;

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function listLoadouts(venueId: string, spaceId: string): Promise<Loadout[]> {
  return api.get(`/venues/${venueId}/spaces/${spaceId}/loadouts`, z.array(LoadoutSchema));
}

export async function getLoadout(venueId: string, spaceId: string, id: string): Promise<LoadoutDetail> {
  return api.get(`/venues/${venueId}/spaces/${spaceId}/loadouts/${id}`, LoadoutDetailSchema);
}

/** A create and a change answer with the row itself, without its photos
 *  (the detail read carries those). Parsed as a detail, every successful
 *  create and rename was reported as a failure. */
export async function createLoadout(venueId: string, spaceId: string, name: string, description?: string): Promise<ReferenceLoadoutRow> {
  return api.post(`/venues/${venueId}/spaces/${spaceId}/loadouts`, { name, description }, undefined, ReferenceLoadoutRowSchema);
}

export async function updateLoadout(venueId: string, spaceId: string, id: string, data: { name?: string; description?: string | null }): Promise<ReferenceLoadoutRow> {
  return api.patch(`/venues/${venueId}/spaces/${spaceId}/loadouts/${id}`, data, ReferenceLoadoutRowSchema);
}

export async function deleteLoadout(venueId: string, spaceId: string, id: string): Promise<void> {
  return api.delete(`/venues/${venueId}/spaces/${spaceId}/loadouts/${id}`);
}

export async function addPhoto(loadoutId: string, fileId: string, caption?: string): Promise<LoadoutPhoto> {
  return api.post(`/loadouts/${loadoutId}/photos`, { fileId, caption }, undefined, LoadoutPhotoSchema);
}

export async function updatePhoto(loadoutId: string, photoId: string, data: { caption?: string | null; sortOrder?: number }): Promise<LoadoutPhoto> {
  return api.patch(`/loadouts/${loadoutId}/photos/${photoId}`, data, LoadoutPhotoSchema);
}

export async function deletePhoto(loadoutId: string, photoId: string): Promise<void> {
  return api.delete(`/loadouts/${loadoutId}/photos/${photoId}`);
}

export async function reorderPhotos(loadoutId: string, photoIds: readonly string[]): Promise<LoadoutPhoto[]> {
  return api.post(`/loadouts/${loadoutId}/photos/reorder`, { photoIds }, undefined, z.array(LoadoutPhotoSchema));
}
