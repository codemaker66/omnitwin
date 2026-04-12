import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types
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
}

export interface PlacedObject {
  readonly id: string;
  readonly configurationId: string;
  readonly assetDefinitionId: string;
  readonly positionX: string;
  readonly positionY: string;
  readonly positionZ: string;
  readonly rotationX: string;
  readonly rotationY: string;
  readonly rotationZ: string;
  readonly scale: string;
  readonly sortOrder: number;
  readonly metadata: ObjectMetadata | null;
}

export interface Configuration {
  readonly id: string;
  readonly spaceId: string;
  readonly venueId: string;
  readonly userId: string | null;
  readonly name: string;
  readonly isPublicPreview: boolean;
  readonly objects?: readonly PlacedObject[];
}

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

// ---------------------------------------------------------------------------
// Public endpoints (no auth)
// ---------------------------------------------------------------------------

export async function createPublicConfig(spaceId: string, name?: string): Promise<Configuration> {
  return api.post<Configuration>("/public/configurations", { spaceId, name }, true);
}

export async function publicBatchSave(configId: string, objects: readonly BatchObjectInput[]): Promise<PlacedObject[]> {
  return api.post<PlacedObject[]>(`/public/configurations/${configId}/objects/batch`, { objects }, true);
}

export async function getPublicConfig(configId: string): Promise<Configuration> {
  return api.get<Configuration>(`/public/configurations/${configId}`);
}

/**
 * Set the floor plan thumbnail on a public preview config.
 * Accepts a PNG data URL from the orthographic capture.
 * Punch list #24: wires the ortho-capture utility to the hallkeeper sheet.
 */
export async function updatePublicThumbnail(configId: string, thumbnailUrl: string): Promise<Configuration> {
  return api.post<Configuration>(`/public/configurations/${configId}/thumbnail`, { thumbnailUrl }, true);
}

// ---------------------------------------------------------------------------
// Authenticated endpoints
// ---------------------------------------------------------------------------

export async function getConfig(configId: string): Promise<Configuration> {
  return api.get<Configuration>(`/configurations/${configId}`);
}

export async function claimConfig(configId: string): Promise<Configuration> {
  return api.post<Configuration>(`/configurations/${configId}/claim`);
}

export async function authBatchSave(configId: string, objects: readonly BatchObjectInput[]): Promise<PlacedObject[]> {
  return api.post<PlacedObject[]>(`/configurations/${configId}/objects/batch`, { objects });
}

// ---------------------------------------------------------------------------
// Guest enquiry
// ---------------------------------------------------------------------------

export interface GuestEnquiryInput {
  readonly configurationId: string;
  readonly email: string;
  readonly phone?: string;
  readonly name?: string;
  readonly eventDate?: string;
  readonly eventType?: string;
  readonly guestCount?: number;
  readonly message?: string;
}

export interface GuestEnquiryResponse {
  readonly enquiryId: string;
  readonly message: string;
}

export async function submitGuestEnquiry(input: GuestEnquiryInput): Promise<GuestEnquiryResponse> {
  return api.post<GuestEnquiryResponse>("/public/enquiries", input, true);
}
