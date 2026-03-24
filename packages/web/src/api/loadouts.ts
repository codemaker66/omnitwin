import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Loadout {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly photoCount: number;
  readonly coverFileKey: string | null;
}

export interface LoadoutPhoto {
  readonly id: string;
  readonly fileId: string;
  readonly caption: string | null;
  readonly sortOrder: number;
  readonly fileKey: string;
  readonly filename: string;
  readonly contentType: string;
}

export interface LoadoutDetail {
  readonly id: string;
  readonly spaceId: string;
  readonly venueId: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly photos: readonly LoadoutPhoto[];
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function listLoadouts(venueId: string, spaceId: string): Promise<Loadout[]> {
  return api.get<Loadout[]>(`/venues/${venueId}/spaces/${spaceId}/loadouts`);
}

export async function getLoadout(venueId: string, spaceId: string, id: string): Promise<LoadoutDetail> {
  return api.get<LoadoutDetail>(`/venues/${venueId}/spaces/${spaceId}/loadouts/${id}`);
}

export async function createLoadout(venueId: string, spaceId: string, name: string, description?: string): Promise<LoadoutDetail> {
  return api.post<LoadoutDetail>(`/venues/${venueId}/spaces/${spaceId}/loadouts`, { name, description });
}

export async function updateLoadout(venueId: string, spaceId: string, id: string, data: { name?: string; description?: string | null }): Promise<LoadoutDetail> {
  return api.patch<LoadoutDetail>(`/venues/${venueId}/spaces/${spaceId}/loadouts/${id}`, data);
}

export async function deleteLoadout(venueId: string, spaceId: string, id: string): Promise<void> {
  return api.delete(`/venues/${venueId}/spaces/${spaceId}/loadouts/${id}`);
}

export async function addPhoto(loadoutId: string, fileId: string, caption?: string): Promise<LoadoutPhoto> {
  return api.post<LoadoutPhoto>(`/loadouts/${loadoutId}/photos`, { fileId, caption });
}

export async function updatePhoto(loadoutId: string, photoId: string, data: { caption?: string | null; sortOrder?: number }): Promise<LoadoutPhoto> {
  return api.patch<LoadoutPhoto>(`/loadouts/${loadoutId}/photos/${photoId}`, data);
}

export async function deletePhoto(loadoutId: string, photoId: string): Promise<void> {
  return api.delete(`/loadouts/${loadoutId}/photos/${photoId}`);
}

export async function reorderPhotos(loadoutId: string, photoIds: readonly string[]): Promise<LoadoutPhoto[]> {
  return api.post<LoadoutPhoto[]>(`/loadouts/${loadoutId}/photos/reorder`, { photoIds });
}
